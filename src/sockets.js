/**
 * @format
 */
// @ts-check

const logger = require('winston')
const Common = require('shock-common')
const mapValues = require('lodash/mapValues')

const auth = require('../services/auth/auth')
const Encryption = require('../utils/encryptionStore')
const LightningServices = require('../utils/lightningServices')
const {
  getGun,
  getUser,
  isAuthenticated
} = require('../services/gunDB/Mediator')
const { deepDecryptIfNeeded } = require('../services/gunDB/rpc')
const GunEvents = require('../services/gunDB/contact-api/events')
const { messagesManager } = require('../services/chatBots')
/**
 * @typedef {import('../services/gunDB/Mediator').SimpleSocket} SimpleSocket
 * @typedef {import('../services/gunDB/contact-api/SimpleGUN').ValidDataValue} ValidDataValue
 */

module.exports = (
  /** @type {import('socket.io').Server} */
  io
) => {
  // This should be used for encrypting and emitting your data
  const emitEncryptedEvent = ({ eventName, data, socket }) => {
    try {
      if (Encryption.isNonEncrypted(eventName)) {
        return socket.emit(eventName, data)
      }

      const deviceId = socket.handshake.query['x-shockwallet-device-id']
      const authorized = Encryption.isAuthorizedDevice({ deviceId })

      if (!deviceId) {
        throw {
          field: 'deviceId',
          message: 'Please specify a device ID'
        }
      }

      if (!authorized) {
        throw {
          field: 'deviceId',
          message: 'Please exchange keys with the API before using the socket'
        }
      }

      const encryptedMessage = Encryption.encryptMessage({
        message: data,
        deviceId
      })

      return socket.emit(eventName, encryptedMessage)
    } catch (err) {
      logger.error(
        `[SOCKET] An error has occurred while encrypting an event (${eventName}):`,
        err
      )

      return socket.emit('encryption:error', err)
    }
  }

  const parseJSON = data => {
    try {
      if (typeof data === 'string') {
        return JSON.parse(data)
      }

      return data
    } catch (err) {
      return data
    }
  }

  const decryptEvent = ({ eventName, data, socket }) => {
    try {
      const deviceId = socket.handshake.query['x-shockwallet-device-id']
      if (Encryption.isNonEncrypted(eventName)) {
        return data
      }

      if (!data) {
        return data
      }

      const parsedData = parseJSON(data)

      if (!deviceId) {
        throw {
          field: 'deviceId',
          message: 'Please specify a device ID'
        }
      }

      if (!Encryption.isAuthorizedDevice({ deviceId })) {
        throw {
          field: 'deviceId',
          message: 'Please exchange keys with the API before using the socket'
        }
      }

      const decryptedKey = Encryption.decryptKey({
        deviceId,
        message: parsedData.encryptedKey
      })
      const decryptedMessage = Encryption.decryptMessage({
        message: parsedData.encryptedData,
        key: decryptedKey,
        iv: parsedData.iv
      })
      const decryptedData = JSON.parse(decryptedMessage)
      return decryptedData
    } catch (err) {
      logger.error(
        `[SOCKET] An error has occurred while decrypting an event (${eventName}):`,
        err
      )

      return socket.emit('encryption:error', err)
    }
  }

  const onNewInvoice = (socket, subID) => {
    const { lightning } = LightningServices.services
    logger.warn('Subscribing to invoices socket...' + subID)
    const stream = lightning.subscribeInvoices({})
    stream.on('data', data => {
      logger.info('[SOCKET] New invoice data:', data)
      emitEncryptedEvent({ eventName: 'invoice:new', data, socket })
    })
    stream.on('end', () => {
      logger.info('New invoice stream ended, starting a new one...')
      // Prevents call stack overflow exceptions
      //process.nextTick(() => onNewInvoice(socket))
    })
    stream.on('error', err => {
      logger.error('New invoice stream error:' + subID, err)
    })
    stream.on('status', status => {
      logger.warn('New invoice stream status:' + subID, status)
      switch (status.code) {
        case 0: {
          logger.info('[event:invoice:new] stream ok')
          break
        }
        case 1: {
          logger.info(
            '[event:invoice:new] stream canceled, probably socket disconnected'
          )
          break
        }
        case 2: {
          logger.warn('[event:invoice:new] got UNKNOWN error status')
          break
        }
        case 12: {
          logger.warn(
            '[event:invoice:new] LND locked, new registration in 60 seconds'
          )
          process.nextTick(() =>
            setTimeout(() => onNewInvoice(socket, subID), 60000)
          )
          break
        }
        case 13: {
          //https://grpc.github.io/grpc/core/md_doc_statuscodes.html
          logger.error('[event:invoice:new] INTERNAL LND error')
          break
        }
        case 14: {
          logger.error(
            '[event:invoice:new] LND disconnected, sockets reconnecting in 30 seconds...'
          )
          process.nextTick(() =>
            setTimeout(() => onNewInvoice(socket, subID), 30000)
          )
          break
        }
        default: {
          logger.error('[event:invoice:new] UNKNOWN LND error')
        }
      }
    })
    return () => {
      stream.cancel()
    }
  }

  const onNewTransaction = (socket, subID) => {
    const { lightning } = LightningServices.services
    const stream = lightning.subscribeTransactions({})
    logger.warn('Subscribing to transactions socket...' + subID)
    stream.on('data', data => {
      logger.info('[SOCKET] New transaction data:', data)
      emitEncryptedEvent({ eventName: 'transaction:new', data, socket })
    })
    stream.on('end', () => {
      logger.info('New transactions stream ended, starting a new one...')
      //process.nextTick(() => onNewTransaction(socket))
    })
    stream.on('error', err => {
      logger.error('New transactions stream error:' + subID, err)
    })
    stream.on('status', status => {
      logger.info('New transactions stream status:' + subID, status)
      switch (status.code) {
        case 0: {
          logger.info('[event:transaction:new] stream ok')
          break
        }
        case 1: {
          logger.info(
            '[event:transaction:new] stream canceled, probably socket disconnected'
          )
          break
        }
        case 2: {
          //Happens to fire when the grpc client lose access to macaroon file
          logger.warn('[event:transaction:new] got UNKNOWN error status')
          break
        }
        case 12: {
          logger.warn(
            '[event:transaction:new] LND locked, new registration in 60 seconds'
          )
          process.nextTick(() =>
            setTimeout(() => onNewTransaction(socket, subID), 60000)
          )
          break
        }
        case 13: {
          //https://grpc.github.io/grpc/core/md_doc_statuscodes.html
          logger.error('[event:transaction:new] INTERNAL LND error')
          break
        }
        case 14: {
          logger.error(
            '[event:transaction:new] LND disconnected, sockets reconnecting in 30 seconds...'
          )
          process.nextTick(() =>
            setTimeout(() => onNewTransaction(socket, subID), 30000)
          )
          break
        }
        default: {
          logger.error('[event:transaction:new] UNKNOWN LND error')
        }
      }
    })
    return () => {
      stream.cancel()
    }
  }

  io.of('default').on('connection', socket => {
    logger.info(`io.onconnection`)
    logger.info('socket.handshake', socket.handshake)

    const isLNDSocket = !!socket.handshake.query.IS_LND_SOCKET
    const isNotificationsSocket = !!socket.handshake.query
      .IS_NOTIFICATIONS_SOCKET

    if (!isLNDSocket) {
      /** printing out the client who joined */
      logger.info('New socket client connected (id=' + socket.id + ').')
    }

    if (isLNDSocket) {
      const subID = Math.floor(Math.random() * 1000).toString()
      const isNotifications = isNotificationsSocket ? 'notifications' : ''
      logger.info('[LND] New LND Socket created:' + isNotifications + subID)
      const cancelInvoiceStream = onNewInvoice(socket, subID)
      const cancelTransactionStream = onNewTransaction(socket, subID)
      socket.on('disconnect', () => {
        logger.info('LND socket disconnected:' + isNotifications + subID)
        cancelInvoiceStream()
        cancelTransactionStream()
      })
    }
  })

  io.of('gun').on('connect', socket => {
    // TODO: off()

    try {
      if (!isAuthenticated()) {
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
        return
      }

      const { $shock, publicKeyForDecryption } = socket.handshake.query

      const [root, path, method] = $shock.split('::')

      // eslint-disable-next-line init-declarations
      let node

      if (root === '$gun') {
        node = getGun()
      } else if (root === '$user') {
        node = getUser()
      } else {
        node = getGun().user(root)
      }

      for (const bit of path.split('>')) {
        node = node.get(bit)
      }

      /**
       * @param {ValidDataValue} data
       * @param {string} key
       */
      const listener = async (data, key) => {
        try {
          if (
            typeof publicKeyForDecryption === 'string' &&
            publicKeyForDecryption !== 'undefined' &&
            publicKeyForDecryption.length > 15
          ) {
            const decData = await deepDecryptIfNeeded(
              data,
              publicKeyForDecryption
            )

            socket.emit('$shock', decData, key)
          } else {
            socket.emit('$shock', data, key)
          }
        } catch (err) {
          logger.error(
            `Error for gun rpc socket, query ${$shock} -> ${err.message}`
          )
        }
      }

      if (method === 'on') {
        node.on(listener)
      } else if (method === 'open') {
        node.open(listener)
      } else if (method === 'map.on') {
        node.map().on(listener)
      } else if (method === 'map.once') {
        node.map().once(listener)
      } else {
        throw new TypeError(
          `Invalid method for gun rpc call : ${method}, query: ${$shock}`
        )
      }
    } catch (err) {
      logger.error('GUNRPC: ' + err.message)
    }
  })

  io.of('lndstreaming').on('connect', socket => {
    // TODO: unsubscription

    /**
     * Streaming stuff in LND uses these events: data, status, end, error.
     */

    try {
      if (!isAuthenticated()) {
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
        return
      }

      const { services } = LightningServices

      const { service, method, args: unParsed } = socket.handshake.query

      const args = JSON.parse(unParsed)

      const call = services[service][method](args)

      call.on('data', _data => {
        // socket.io serializes buffers differently from express
        const data = (() => {
          if (!Common.Schema.isObj(_data)) {
            return _data
          }

          return mapValues(_data, (item, key) => {
            if (!(item instanceof Buffer)) {
              return item
            }

            return item.toJSON()
          })
        })()

        socket.emit('data', data)
      })

      call.on('status', status => {
        socket.emit('status', status)
      })

      call.on('end', () => {
        socket.emit('end')
      })

      call.on('error', err => {
        // 'error' is a reserved event name we can't use it
        socket.emit('$error', err)
      })

      // Possibly allow streaming writes such as sendPaymentV2
      socket.on('write', args => {
        call.write(args)
      })
    } catch (err) {
      logger.error('LNDRPC: ' + err.message)
    }
  })

  /**
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  const isValidToken = async token => {
    const validation = await auth.validateToken(token)

    if (typeof validation !== 'object') {
      return false
    }

    if (validation === null) {
      return false
    }

    if (typeof validation.valid !== 'boolean') {
      return false
    }

    return validation.valid
  }

  /** @type {null|NodeJS.Timeout} */
  let pingIntervalID = null

  io.of('shockping').on(
    'connect',
    // TODO: make this sync
    async socket => {
      try {
        logger.info('Received connect request for shockping socket')
        if (!isAuthenticated()) {
          logger.info(
            'not authenticated in gun for shockping socket, will send NOT_AUTH'
          )
          socket.emit(Common.Constants.ErrorCode.NOT_AUTH)

          return
        }

        logger.info('now checking token')
        const { token } = socket.handshake.query
        const isAuth = await isValidToken(token)

        if (!isAuth) {
          logger.warn('invalid token for socket ping')
          socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
          return
        }

        if (pingIntervalID !== null) {
          logger.error(
            'Tried to set ping socket twice, this might be due to an app restart and the old socket not being recycled by socket.io in time, will disable the older ping interval, which means the old socket wont work and will ping this new socket instead'
          )
          clearInterval(pingIntervalID)
          pingIntervalID = null
        }

        pingIntervalID = setInterval(() => {
          socket.emit('shockping')
        }, 3000)

        socket.on('disconnect', () => {
          logger.warn('ping socket disconnected')
          if (pingIntervalID !== null) {
            clearInterval(pingIntervalID)
            pingIntervalID = null
          }
        })
      } catch (err) {
        logger.error('Error inside shockping connect: ' + err.message)
        socket.emit('$error', err.message)
      }
    }
  )

  // TODO: do this through rpc

  const emptyUnsub = () => {}

  let chatsUnsub = emptyUnsub

  io.of('chats').on('connect', async socket => {
    try {
      if (!isAuthenticated()) {
        logger.info(
          'not authenticated in gun for chats socket, will send NOT_AUTH'
        )
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)

        return
      }

      logger.info('now checking token for chats socket')
      const { token } = socket.handshake.query
      const isAuth = await isValidToken(token)

      if (!isAuth) {
        logger.warn('invalid token for chats socket')
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
        return
      }

      if (chatsUnsub !== emptyUnsub) {
        logger.error(
          'Tried to set chats socket twice, this might be due to an app restart and the old socket not being recycled by socket.io in time, will disable the older subscription, which means the old socket wont work and data will be sent to this new socket instead'
        )
        chatsUnsub()
        chatsUnsub = emptyUnsub
      }

      /**
       * @param {Common.Schema.Chat[]} allChats
       */
      const emitProcessedChats = allChats => {
        socket.emit('$shock', allChats)
      }
      messagesManager.ConnectBots(emitProcessedChats)

      /**
       * @param {Common.Schema.Chat[]} chats
       */
      const onChats = chats => {
        const processed = chats.map(
          ({
            didDisconnect,
            id,
            lastSeenApp,
            messages,
            recipientPublicKey
          }) => {
            /** @type {Common.Schema.Chat} */
            const stripped = {
              didDisconnect,
              id,
              lastSeenApp,
              messages,
              recipientAvatar: null,
              recipientDisplayName: null,
              recipientPublicKey
            }

            return stripped
          }
        )
        const allChats = messagesManager.joinGunChats(processed)
        emitProcessedChats(allChats)
      }

      chatsUnsub = GunEvents.onChats(onChats)

      socket.on('disconnect', () => {
        chatsUnsub()
        chatsUnsub = emptyUnsub
      })
    } catch (e) {
      logger.error('Error inside chats socket connect: ' + e.message)
      socket.emit('$error', e.message)
    }
  })

  let sentReqsUnsub = emptyUnsub

  io.of('sentReqs').on('connect', async socket => {
    try {
      if (!isAuthenticated()) {
        logger.info(
          'not authenticated in gun for sentReqs socket, will send NOT_AUTH'
        )
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)

        return
      }

      logger.info('now checking token for sentReqs socket')
      const { token } = socket.handshake.query
      const isAuth = await isValidToken(token)

      if (!isAuth) {
        logger.warn('invalid token for sentReqs socket')
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
        return
      }

      if (sentReqsUnsub !== emptyUnsub) {
        logger.error(
          'Tried to set sentReqs socket twice, this might be due to an app restart and the old socket not being recycled by socket.io in time, will disable the older subscription, which means the old socket wont work and data will be sent to this new socket instead'
        )
        sentReqsUnsub()
        sentReqsUnsub = emptyUnsub
      }

      /**
       * @param {Common.Schema.SimpleSentRequest[]} sentReqs
       */
      const onSentReqs = sentReqs => {
        const processed = sentReqs.map(
          ({
            id,
            recipientChangedRequestAddress,
            recipientPublicKey,
            timestamp
          }) => {
            /**
             * @type {Common.Schema.SimpleSentRequest}
             */
            const stripped = {
              id,
              recipientAvatar: null,
              recipientChangedRequestAddress,
              recipientDisplayName: null,
              recipientPublicKey,
              timestamp
            }

            return stripped
          }
        )
        socket.emit('$shock', processed)
      }

      sentReqsUnsub = GunEvents.onSimplerSentRequests(onSentReqs)

      socket.on('disconnect', () => {
        sentReqsUnsub()
        sentReqsUnsub = emptyUnsub
      })
    } catch (e) {
      logger.error('Error inside sentReqs socket connect: ' + e.message)
      socket.emit('$error', e.message)
    }
  })

  let receivedReqsUnsub = emptyUnsub

  io.of('receivedReqs').on('connect', async socket => {
    try {
      if (!isAuthenticated()) {
        logger.info(
          'not authenticated in gun for receivedReqs socket, will send NOT_AUTH'
        )
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)

        return
      }

      logger.info('now checking token for receivedReqs socket')
      const { token } = socket.handshake.query
      const isAuth = await isValidToken(token)

      if (!isAuth) {
        logger.warn('invalid token for receivedReqs socket')
        socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
        return
      }

      if (receivedReqsUnsub !== emptyUnsub) {
        logger.error(
          'Tried to set receivedReqs socket twice, this might be due to an app restart and the old socket not being recycled by socket.io in time, will disable the older subscription, which means the old socket wont work and data will be sent to this new socket instead'
        )
        receivedReqsUnsub()
        receivedReqsUnsub = emptyUnsub
      }

      /**
       * @param {Common.Schema.SimpleReceivedRequest[]} receivedReqs
       */
      const onReceivedReqs = receivedReqs => {
        const processed = receivedReqs.map(({ id, requestorPK, timestamp }) => {
          /** @type {Common.Schema.SimpleReceivedRequest} */
          const stripped = {
            id,
            requestorAvatar: null,
            requestorDisplayName: null,
            requestorPK,
            timestamp
          }

          return stripped
        })

        socket.emit('$shock', processed)
      }

      receivedReqsUnsub = GunEvents.onSimplerReceivedRequests(onReceivedReqs)

      socket.on('disconnect', () => {
        receivedReqsUnsub()
        receivedReqsUnsub = emptyUnsub
      })
    } catch (e) {
      logger.error('Error inside receivedReqs socket connect: ' + e.message)
      socket.emit('$error', e.message)
    }
  })

  return io
}
