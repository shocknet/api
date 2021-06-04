/**
 * @prettier
 */
process.on('uncaughtException', e => {
  console.log('something bad happened!')
  console.log(e)
})
/**
 * Module dependencies.
 */
const server = program => {
  const Http = require('http')
  const Express = require('express')
  const Crypto = require('crypto')
  const Dotenv = require('dotenv')
  const Storage = require('node-persist')
  const Path = require('path')
  const { Logger: CommonLogger } = require('shock-common')
  const binaryParser = require('socket.io-msgpack-parser')
  const { fork } = require('child_process')
  const EventEmitter = require('events')
  const FS = require('fs')
  const Https = require('https')

  const ECC = require('../utils/ECC')
  const LightningServices = require('../utils/lightningServices')
  const Encryption = require('../utils/encryptionStore')
  const app = Express()

  const compression = require('compression')
  const bodyParser = require('body-parser')
  const session = require('express-session')
  const methodOverride = require('method-override')
  const qrcode = require('qrcode-terminal')
  const {
    unprotectedRoutes,
    sensitiveRoutes,
    nonEncryptedRoutes
  } = require('../utils/protectedRoutes')

  // load app default configuration data
  const defaults = require('../config/defaults')(program.mainnet)
  const rootFolder = program.rootPath || process.resourcesPath || __dirname

  // define env variables
  Dotenv.config()

  const serverPort = program.serverport || defaults.serverPort
  const serverHost = program.serverhost || defaults.serverHost
  const tunnelHost = process.env.LOCAL_TUNNEL_SERVER || defaults.localtunnelHost

  // setup winston logging ==========
  const logger = require('../config/log')(
    program.logfile || defaults.logfile,
    program.loglevel || defaults.loglevel
  )

  CommonLogger.setLogger(logger)

  // utilities functions =================
  require('../utils/server-utils')(module)

  logger.info('Mainnet Mode:', !!program.mainnet)
  const tunnelTimeout = 5000
  let latestAliveTunnel = 0
  let tunnelHealthInterval = null
  const tunnelHealthManager = new EventEmitter()
  tunnelHealthManager.on('fork', ({ params, cb }) => {
    if (latestAliveTunnel !== 0 && latestAliveTunnel < tunnelTimeout) {
      return
    }
    clearInterval(tunnelHealthInterval)
    tunnelHealthInterval = setInterval(() => {
      if (Date.now() - latestAliveTunnel > tunnelTimeout) {
        console.log('oh no! tunnel is dead, will restart it now')
        tunnelHealthManager.emit('fork', { params, cb })
      }
    }, 2000)
    const forked = fork('src/tunnel.js')
    forked.on('message', msg => {
      //console.log('Message from child', msg);
      if (msg && msg.type === 'info') {
        cb(msg.tunnel)
      }
      latestAliveTunnel = Date.now()
    })
    forked.send(params)
  })

  if (process.env.SHOCK_ENCRYPTION_ECC === 'false') {
    logger.error('Encryption Mode: false')
  } else {
    logger.info('Encryption Mode: true')
  }

  const stringifyData = data => {
    if (typeof data === 'object') {
      const stringifiedData = JSON.stringify(data)
      return stringifiedData
    }

    if (data.toString) {
      return data.toString()
    }

    return data
  }

  const hashData = data => {
    return Crypto.createHash('SHA256')
      .update(Buffer.from(stringifyData(data)))
      .digest('hex')
  }

  const cacheCheck = ({ req, res, args, send }) => {
    if (
      (process.env.SHOCK_CACHE === 'true' || !process.env.SHOCK_CACHE) &&
      req.method === 'GET'
    ) {
      const dataHash = hashData(args[0]).slice(-8)
      res.set('shock-cache-hash', dataHash)

      logger.debug('shock-cache-hash:', req.headers['shock-cache-hash'])
      logger.debug('Data Hash:', dataHash)
      if (
        !req.headers['shock-cache-hash'] &&
        (process.env.CACHE_HEADERS_MANDATORY === 'true' ||
          !process.env.CACHE_HEADERS_MANDATORY)
      ) {
        logger.warn(
          "Request is missing 'shock-cache-hash' header, please make sure to include that in each GET request in order to benefit from reduced data usage"
        )
        return { cached: false, hash: dataHash }
      }

      if (req.headers['shock-cache-hash'] === dataHash) {
        logger.debug('Same Hash Detected!')
        args[0] = null
        res.status(304)
        send.apply(res, args)
        return { cached: true, hash: dataHash }
      }

      return { cached: false, hash: dataHash }
    }

    return { cached: false, hash: null }
  }

  /**
   * @param {Express.Request} req
   * @param {Express.Response} res
   * @param {(() => void)} next
   */
  const modifyResponseBody = (req, res, next) => {
    const legacyDeviceId = req.headers['x-shockwallet-device-id']
    const deviceId = req.headers['encryption-device-id']
    const oldSend = res.send

    if (
      nonEncryptedRoutes.includes(req.path) ||
      process.env.SHOCK_ENCRYPTION_ECC === 'false'
    ) {
      next()
      return
    }

    if (legacyDeviceId) {
      res.send = (...args) => {
        if (args[0] && args[0].encryptedData && args[0].encryptionKey) {
          logger.warn('Response loop detected!')
          oldSend.apply(res, args)
          return
        }

        const { cached, hash } = cacheCheck({ req, res, args, send: oldSend })

        if (cached) {
          return
        }

        // arguments[0] (or `data`) contains the response body
        const authorized = Encryption.isAuthorizedDevice({
          deviceId: legacyDeviceId
        })
        const encryptedMessage = authorized
          ? Encryption.encryptMessage({
              message: args[0] ? args[0] : {},
              deviceId: legacyDeviceId,
              metadata: {
                hash
              }
            })
          : args[0]
        args[0] = JSON.stringify(encryptedMessage)
        oldSend.apply(res, args)
      }
    }

    if (deviceId) {
      res.send = (...args) => {
        if (args[0] && args[0].ciphertext && args[0].iv) {
          logger.warn('Response loop detected!')
          oldSend.apply(res, args)
          return
        }

        const authorized = ECC.isAuthorizedDevice({
          deviceId
        })

        // Using classic promises syntax to avoid
        // modifying res.send's return type
        if (authorized && process.env.SHOCK_ENCRYPTION_ECC !== 'false') {
          ECC.encryptMessage({
            deviceId,
            message: args[0]
          }).then(encryptedMessage => {
            args[0] = JSON.stringify(encryptedMessage)
            oldSend.apply(res, args)
          })
        }

        if (!authorized || process.env.SHOCK_ENCRYPTION_ECC === 'false') {
          args[0] = JSON.stringify(args[0])
          oldSend.apply(res, args)
        }
      }
    }

    next()
  }

  const wait = seconds =>
    new Promise(resolve => {
      const timer = setTimeout(() => resolve(timer), seconds * 1000)
    })

  // eslint-disable-next-line consistent-return
  const startServer = async () => {
    try {
      LightningServices.setDefaults(program)
      if (!LightningServices.isInitialized()) {
        await LightningServices.init()
      }

      await new Promise((resolve, reject) => {
        LightningServices.services.lightning.getInfo({}, (err, res) => {
          if (err && err.code !== 12) {
            reject(err)
          } else {
            resolve()
          }
        })
      })

      const auth = require('../services/auth/auth')

      app.use(compression())

      app.use((req, res, next) => {
        if (process.env.ROUTE_LOGGING === 'true') {
          if (sensitiveRoutes[req.method][req.path]) {
            logger.info(
              JSON.stringify({
                time: new Date(),
                ip: req.ip,
                method: req.method,
                path: req.path,
                sessionId: req.sessionId
              })
            )
          } else {
            logger.info(
              JSON.stringify({
                time: new Date(),
                ip: req.ip,
                method: req.method,
                path: req.path,
                body: req.body,
                query: req.query,
                sessionId: req.sessionId
              })
            )
          }
        }
        next()
      })

      app.use((req, res, next) => {
        res.set('Version', program.version ? program.version() : 'N/A')
        next()
      })

      const storageDirectory = Path.resolve(
        rootFolder,
        `${program.rootPath ? '.' : '..'}/.storage`
      )

      await Storage.init({
        dir: storageDirectory
      }) /*
      if (false) {
        await Storage.removeItem('tunnel/token')
        await Storage.removeItem('tunnel/subdomain')
        await Storage.removeItem('tunnel/url')
      }*/

      const storePersistentRandomField = async ({ fieldName, length = 16 }) => {
        const randomField = await Storage.getItem(fieldName)

        if (randomField) {
          return randomField
        }

        const newValue = await Encryption.generateRandomString(length)
        await Storage.setItem(fieldName, newValue)
        return newValue
      }

      const [sessionSecret] = await Promise.all([
        storePersistentRandomField({
          fieldName: 'config/sessionSecret'
        }),
        storePersistentRandomField({
          fieldName: 'encryption/hostId',
          length: 8
        })
      ])

      app.use(
        session({
          secret: sessionSecret,
          cookie: { maxAge: defaults.sessionMaxAge },
          resave: true,
          rolling: true,
          saveUninitialized: true
        })
      )
      app.use(bodyParser.urlencoded({ extended: 'true' }))
      app.use(bodyParser.json())
      app.use(bodyParser.json({ type: 'application/vnd.api+json' }))
      app.use(methodOverride())
      // WARNING
      // error handler middleware, KEEP 4 parameters as express detects the
      // arity of the function to treat it as a err handling middleware
      // eslint-disable-next-line no-unused-vars
      app.use((err, _, res, __) => {
        // Do logging and user-friendly error message display
        logger.error(err)
        res.status(500).send({ status: 500, errorMessage: 'internal error' })
      })

      const CA =
        program.httpsCert || LightningServices.servicesConfig.lndCertPath
      const CA_KEY = program.httpsCertKey || CA.replace('cert', 'key')

      const createServer = () => {
        try {
          if (LightningServices.servicesConfig.lndCertPath && program.useTLS) {
            const key = FS.readFileSync(CA_KEY, 'utf-8')
            const cert = FS.readFileSync(CA, 'utf-8')

            const httpsServer = Https.createServer({ key, cert }, app)

            return httpsServer
          }

          const httpServer = Http.Server(app)
          return httpServer
        } catch (err) {
          logger.error(err.message)
          logger.error(
            'An error has occurred while finding an LND cert to use to open an HTTPS server'
          )
          logger.warn('Falling back to opening an HTTP server...')
          const httpServer = Http.Server(app)
          return httpServer
        }
      }

      const serverInstance = createServer()

      const io = require('socket.io')(serverInstance, {
        parser: binaryParser,
        transports: ['websocket', 'polling'],
        cors: {
          origin: (origin, callback) => {
            callback(null, true)
          },
          allowedHeaders: [
            'Origin',
            'X-Requested-With',
            'Content-Type',
            'Accept',
            'Authorization',
            'public-key-for-decryption',
            'encryption-device-id'
          ],
          credentials: true
        }
      })

      const Sockets = require('./sockets')(io)

      require('./routes')(
        app,
        {
          ...defaults,
          lndAddress: program.lndAddress
        },
        Sockets,
        {
          serverHost,
          serverPort,
          useTLS: program.useTLS,
          CA,
          CA_KEY
        }
      )

      // enable CORS headers
      app.use(require('./cors'))
      // app.use(bodyParser.json({limit: '100000mb'}));
      app.use(bodyParser.json({ limit: '50mb' }))
      app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))
      if (process.env.SHOCK_ENCRYPTION_ECC !== 'false') {
        app.use(modifyResponseBody)
      }

      serverInstance.listen(serverPort, serverHost)

      if (program.tunnel) {
        // setup localtunnel ==========
        const [tunnelToken, tunnelSubdomain, tunnelUrl] = await Promise.all([
          Storage.getItem('tunnel/token'),
          Storage.getItem('tunnel/subdomain'),
          Storage.getItem('tunnel/url')
        ])
        const tunnelOpts = {
          port: serverPort,
          host: tunnelHost,
          print_requests: true
        }
        if (tunnelToken && tunnelSubdomain) {
          tunnelOpts.tunnelToken = tunnelToken
          tunnelOpts.subdomain = tunnelSubdomain
          logger.info('Recreating tunnel... with subdomain: ' + tunnelSubdomain)
        } else {
          logger.info('Creating new tunnel...This will require a pair ')
        }
        tunnelHealthManager.emit('fork', {
          params: tunnelOpts,
          cb: async tunnel => {
            if (tunnelSubdomain !== tunnel.clientId && !tunnel.token) {
              logger.error(
                'An error occurred while opening tunnel, will try again in 2 sec with a new one'
              )

              return
            }
            logger.info('Tunnel created! connect to: ' + tunnel.url)
            const dataToQr = JSON.stringify({
              internalIP: tunnel.url,
              walletPort: 443,
              externalIP: tunnel.url
            })
            qrcode.generate(dataToQr, { small: true })
            if (tunnel.token) {
              console.log('writing to storage...')
              await Promise.all([
                Storage.setItem('tunnel/token', tunnel.token),
                Storage.setItem('tunnel/subdomain', tunnel.clientId),
                Storage.setItem('tunnel/url', tunnel.url)
              ])
            }
          }
        })
      }

      logger.info('App listening on ' + serverHost + ' port ' + serverPort)

      module.server = serverInstance
    } catch (err) {
      logger.error({ exception: err, message: err.message, code: err.code })
      logger.info('Restarting server in 30 seconds...')
      await wait(30)
      startServer()
      return false
    }
  }

  startServer()
}

module.exports = server
