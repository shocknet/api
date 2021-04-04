/**
 * @format
 */
const Gun = require('gun')
const Common = require('shock-common')
// @ts-ignore
require('gun/nts')
const logger = require('winston')
// @ts-ignore
Gun.log = () => {}
// @ts-ignore
require('gun/lib/open')
// @ts-ignore
require('gun/lib/load')
const debounce = require('lodash/debounce')
//@ts-ignore
const { encryptedEmit, encryptedOn } = require('../../../utils/ECC/socket')
const Key = require('../contact-api/key')

/** @type {import('../contact-api/SimpleGUN').ISEA} */
// @ts-ignore
const SEAx = require('gun/sea')
// Re-enable in the future, when SEA errors inside user.auth/etc actually
// propagate up.
// SEAx.throw = true

/** @type {import('../contact-api/SimpleGUN').ISEA} */
const mySEA = {}

// Avoid this: https://github.com/amark/gun/issues/804 and any other issues
const $$__SHOCKWALLET__ENCRYPTED__ = '$$_SHOCKWALLET__ENCRYPTED__'
const $$__SHOCKWALLET__MSG__ = '$$__SHOCKWALLET__MSG__'
const $$__SHOCKWALLET__NUMBER__ = '$$__SHOCKWALLET__NUMBER__'
const $$__SHOCKWALLET__BOOLEAN__ = '$$__SHOCKWALLET__BOOLEAN__'

mySEA.encrypt = (msg, secret) => {
  if (typeof secret !== 'string') {
    throw new TypeError(
      `mySEA.encrypt() -> expected secret to be a an string, args: |msg| -- ${JSON.stringify(
        secret
      )}`
    )
  }

  if (secret.length < 1) {
    throw new TypeError(
      `mySEA.encrypt() -> expected secret to be a populated string`
    )
  }

  let strToEncode = ''

  if (typeof msg === 'string') {
    if (msg.length === 0) {
      throw new TypeError(
        'mySEA.encrypt() -> expected msg to be a populated string'
      )
    }

    strToEncode = $$__SHOCKWALLET__MSG__ + msg
  } else if (typeof msg === 'boolean') {
    strToEncode = $$__SHOCKWALLET__BOOLEAN__ + msg
  } else if (typeof msg === 'number') {
    strToEncode = $$__SHOCKWALLET__NUMBER__ + msg
  } else {
    throw new TypeError('mySea.encrypt() -> Not a valid msg type.')
  }

  return SEAx.encrypt(strToEncode, secret).then(encMsg => {
    return $$__SHOCKWALLET__ENCRYPTED__ + encMsg
  })
}

/**
 * @param {string} encMsg
 * @param {string} secret
 * @returns {Promise<any>}
 */
const decryptBase = (encMsg, secret) => {
  if (typeof encMsg !== 'string') {
    throw new TypeError(
      'mySEA.encrypt() -> expected encMsg to be an string instead got: ' +
        typeof encMsg
    )
  }

  if (encMsg.length === 0) {
    throw new TypeError(
      'mySEA.encrypt() -> expected encMsg to be a populated string'
    )
  }

  if (typeof secret !== 'string') {
    throw new TypeError('mySea.decrypt() -> expected secret to be an string')
  }

  if (secret.length === 0) {
    throw new TypeError(
      'mySea.decrypt() -> expected secret to be a populated string'
    )
  }

  if (encMsg.indexOf($$__SHOCKWALLET__ENCRYPTED__) !== 0) {
    throw new TypeError(
      'Trying to pass a non prefixed encrypted string to mySea.decrypt(): ' +
        encMsg
    )
  }

  return SEAx.decrypt(
    encMsg.slice($$__SHOCKWALLET__ENCRYPTED__.length),
    secret
  ).then(decodedMsg => {
    if (typeof decodedMsg !== 'string') {
      throw new TypeError('Could not decrypt')
    }

    if (decodedMsg.startsWith($$__SHOCKWALLET__MSG__)) {
      return decodedMsg.slice($$__SHOCKWALLET__MSG__.length)
    } else if (decodedMsg.startsWith($$__SHOCKWALLET__BOOLEAN__)) {
      const dec = decodedMsg.slice($$__SHOCKWALLET__BOOLEAN__.length)
      if (dec === 'true') {
        return true
      } else if (dec === 'false') {
        return false
      }
      throw new Error('Could not decrypt boolean value.')
    } else if (decodedMsg.startsWith($$__SHOCKWALLET__NUMBER__)) {
      return Number(decodedMsg.slice($$__SHOCKWALLET__NUMBER__.length))
    }

    throw new TypeError(
      `mySea.encrypt() -> Unexpected type of prefix found inside decrypted value, first 20 characters: ${decodedMsg.slice(
        0,
        20
      )}`
    )
  })
}

mySEA.decrypt = (encMsg, secret) => {
  return decryptBase(encMsg, secret)
}

mySEA.decryptNumber = (encMsg, secret) => {
  return decryptBase(encMsg, secret)
}

mySEA.decryptBoolean = (encMsg, secret) => {
  return decryptBase(encMsg, secret)
}

mySEA.secret = async (recipientOrSenderEpub, recipientOrSenderSEA) => {
  if (typeof recipientOrSenderEpub !== 'string') {
    throw new TypeError(
      'epub has to be an string, args:' +
        `${JSON.stringify(recipientOrSenderEpub)} -- ${JSON.stringify(
          recipientOrSenderSEA
        )}`
    )
  }
  if (recipientOrSenderEpub.length === 0) {
    throw new TypeError(
      'epub has to be populated string, args: ' +
        `${JSON.stringify(recipientOrSenderEpub)} -- ${JSON.stringify(
          recipientOrSenderSEA
        )}`
    )
  }
  if (typeof recipientOrSenderSEA !== 'object') {
    throw new TypeError(
      'sea has to be an object, args: ' +
        `${JSON.stringify(recipientOrSenderEpub)} -- ${JSON.stringify(
          recipientOrSenderSEA
        )}`
    )
  }

  if (recipientOrSenderSEA === null) {
    throw new TypeError(
      'sea has to be nont null, args: ' +
        `${JSON.stringify(recipientOrSenderEpub)} -- ${JSON.stringify(
          recipientOrSenderSEA
        )}`
    )
  }

  if (recipientOrSenderEpub === recipientOrSenderSEA.pub) {
    throw new Error(
      'Do not use pub for mysecret, args: ' +
        `${JSON.stringify(recipientOrSenderEpub)} -- ${JSON.stringify(
          recipientOrSenderSEA
        )}`
    )
  }

  const sec = await SEAx.secret(recipientOrSenderEpub, recipientOrSenderSEA)

  if (typeof sec !== 'string') {
    throw new TypeError(
      `Could not generate secret, args: ${JSON.stringify(
        recipientOrSenderEpub
      )} -- ${JSON.stringify(recipientOrSenderSEA)}`
    )
  }

  if (sec.length === 0) {
    throw new TypeError(
      `SEA.secret returned an empty string!, args: ${JSON.stringify(
        recipientOrSenderEpub
      )} -- ${JSON.stringify(recipientOrSenderSEA)}`
    )
  }

  return sec
}

const auth = require('../../auth/auth')

const { Constants } = require('shock-common')
const { Action, Event } = Constants

const API = require('../contact-api/index')
const Config = require('../config')
// const { nonEncryptedRoutes } = require('../../../utils/protectedRoutes')

/**
 * @typedef {import('../contact-api/SimpleGUN').GUNNode} GUNNode
 * @typedef {import('../contact-api/SimpleGUN').UserGUNNode} UserGUNNode
 * @typedef {import('../contact-api/SimpleGUN').ValidDataValue} ValidDataValue
 */

// TO DO: move to common repo
/**
 * @typedef {object} Emission
 * @prop {boolean} ok
 * @prop {any} msg
 * @prop {Record<string, any>} origBody
 */

/**
 * @typedef {object} EncryptedEmissionLegacy
 * @prop {string} encryptedData
 * @prop {string} encryptedKey
 * @prop {string} iv
 */

/**
 * @typedef {object} EncryptedEmission
 * @prop {string} ciphertext
 * @prop {string} mac
 * @prop {string} iv
 * @prop {string} ephemPublicKey
 */

// TO DO: move to common repo
/**
 * @typedef {object} SimpleSocket
 * @prop {(eventName: string, data?: Emission|EncryptedEmissionLegacy|EncryptedEmission|ValidDataValue) => void} emit
 * @prop {(eventName: string, handler: (data: any) => void) => void} on
 * @prop {{ query: { 'x-shockwallet-device-id': string, encryptionId: string }}} handshake
 */

/* eslint-disable init-declarations */

/** @type {GUNNode} */
// @ts-ignore
let gun

/** @type {UserGUNNode} */
let user

/* eslint-enable init-declarations */

/** @type {string|null} */
let _currentAlias = null
/** @type {string|null} */

/** @type {string|null} */
let mySec = null

/** @returns {string} */
const getMySecret = () => /** @type {string} */ (mySec)

let _isAuthenticating = false
let _isRegistering = false

const isAuthenticated = () => typeof user.is === 'object' && user.is !== null
const isAuthenticating = () => _isAuthenticating
const isRegistering = () => _isRegistering

const getGun = () => {
  return gun
}

const getUser = () => {
  if (!user.is) {
    logger.warn('called getUser() without being authed')
    throw new Error(Constants.ErrorCode.NOT_AUTH)
  }
  return user
}

/**
 * Returns a promise containing the public key of the newly created user.
 * @param {string} alias
 * @param {string} pass
 * @param {UserGUNNode=} __user
 * @returns {Promise<string>}
 */
const authenticate = async (alias, pass, __user) => {
  const _user = __user || user
  const isFreshGun = _user !== user
  if (isFreshGun) {
    const ack = await new Promise(res => {
      _user.auth(alias, pass, _ack => {
        res(_ack)
      })
    })

    if (typeof ack.err === 'string') {
      throw new Error(ack.err)
    } else if (typeof ack.sea === 'object') {
      // clock skew
      await new Promise(res => setTimeout(res, 2000))

      await /** @type {Promise<void>} */ (new Promise((res, rej) => {
        _user.get(Key.FOLLOWS).put(
          {
            unused: null
          },
          ack => {
            if (ack.err && typeof ack.err !== 'number') {
              rej(new Error(`Error initializing follows: ${ack.err}`))
            } else {
              res()
            }
          }
        )
      }))

      return ack.sea.pub
    } else {
      throw new Error('Unknown error.')
    }
  }

  if (isAuthenticated()) {
    if (alias !== _currentAlias) {
      throw new Error(
        `Tried to re-authenticate with an alias different to that of stored one, tried: ${alias} - stored: ${_currentAlias}, logoff first if need to change aliases.`
      )
    }

    // clock skew
    await new Promise(res => setTimeout(res, 2000))

    await /** @type {Promise<void>} */ (new Promise((res, rej) => {
      _user.get(Key.FOLLOWS).put(
        {
          unused: null
        },
        ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(`Error initializing follows: ${ack.err}`))
          } else {
            res()
          }
        }
      )
    }))

    // move this to a subscription; implement off() ? todo
    API.Jobs.onAcceptedRequests(_user, mySEA)
    API.Jobs.onOrders(_user, gun, mySEA)
    API.Jobs.lastSeenNode(_user)

    API.Events.onAvatar(() => {}, user)()
    API.Events.onBio(() => {}, user)
    API.Events.onBlacklist(() => {}, user)
    API.Events.onChats(() => {})()
    API.Events.onCurrentHandshakeAddress(() => {}, user)()
    API.Events.onDisplayName(() => {}, user)()
    API.Events.onOutgoing(() => {})()
    API.Events.onSeedBackup(() => {}, user, mySEA)
    API.Events.onSimplerReceivedRequests(() => {})()
    API.Events.onSimplerSentRequests(() => {})()

    return _user._.sea.pub
  }

  if (isAuthenticating()) {
    throw new Error(
      'A Gun pending/failed login attempt was found, restart api, make an api issue issue use its number so we can gather info there.'
    )
  }

  _isAuthenticating = true

  const ack = await new Promise(res => {
    _user.auth(alias, pass, _ack => {
      res(_ack)
    })
  })

  _isAuthenticating = false

  if (typeof ack.err === 'string') {
    throw new Error(ack.err)
  } else if (Common.isObj(ack.sea)) {
    mySec = await mySEA.secret(_user._.sea.epub, _user._.sea)

    _currentAlias = alias

    await new Promise(res => setTimeout(res, 5000))

    await /** @type {Promise<void>} */ (new Promise((res, rej) => {
      _user.get(Key.FOLLOWS).put(
        {
          unused: null
        },
        ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(`Error initializing follows: ${ack.err}`))
          } else {
            res()
          }
        }
      )
    }))

    API.Jobs.onAcceptedRequests(_user, mySEA)
    API.Jobs.onOrders(_user, gun, mySEA)
    API.Jobs.lastSeenNode(_user)

    API.Events.onAvatar(() => {}, user)()
    API.Events.onBio(() => {}, user)
    API.Events.onBlacklist(() => {}, user)
    API.Events.onChats(() => {})()
    API.Events.onCurrentHandshakeAddress(() => {}, user)()
    API.Events.onDisplayName(() => {}, user)()
    API.Events.onOutgoing(() => {})()
    API.Events.onSeedBackup(() => {}, user, mySEA)
    API.Events.onSimplerReceivedRequests(() => {})()
    API.Events.onSimplerSentRequests(() => {})()

    return ack.sea.pub
  } else {
    logger.error(
      `Unknown error, wrong password? Ack looks like: ${JSON.stringify(ack)}`
    )
    throw new Error(`Didn't work, bad password?`)
  }
}

const logoff = () => {
  user.leave()
}

const instantiateGun = () => {
  if (user) {
    user.leave()
  }
  // @ts-ignore
  user = null
  if (gun) {
    gun.off()
  }
  // @ts-ignore
  gun = null

  const _gun = /** @type {unknown} */ (new Gun({
    axe: false,
    multicast: false,
    peers: ['https://gun.shock.network:8765/gun']
  }))

  gun = /** @type {GUNNode} */ (_gun)

  user = gun.user()
}

instantiateGun()

const freshGun = () => {
  return {
    gun,
    user
  }
}

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

/**
 * @param {string} token
 * @throws {Error} If the token is invalid
 * @returns {Promise<void>}
 */
const throwOnInvalidToken = async token => {
  const isValid = await isValidToken(token)

  if (!isValid) {
    throw new Error('Token expired.')
  }
}

class Mediator {
  /**
   * @param {Readonly<SimpleSocket>} socket
   */
  constructor(socket) {
    this.socket = this.encryptSocketInstance(socket)

    this.connected = true

    this.socket.on('disconnect', this.onDisconnect)

    this.socket.on(Action.ACCEPT_REQUEST, this.acceptRequest)
    this.socket.on(Action.BLACKLIST, this.blacklist)
    this.socket.on(
      Action.GENERATE_NEW_HANDSHAKE_NODE,
      this.generateHandshakeNode
    )
    this.socket.on('GENERATE_ORDER_ADDRESS', this.generateOrderAddress)
    this.socket.on('INIT_FEED_WALL', this.initWall)
    this.socket.on(Action.SEND_HANDSHAKE_REQUEST, this.sendHandshakeRequest)
    this.socket.on(
      Action.SEND_HANDSHAKE_REQUEST_WITH_INITIAL_MSG,
      this.sendHRWithInitialMsg
    )
    this.socket.on(Action.SEND_MESSAGE, this.sendMessage)
    this.socket.on(Action.SET_AVATAR, this.setAvatar)
    this.socket.on(Action.SET_DISPLAY_NAME, this.setDisplayName)
    this.socket.on(Action.SEND_PAYMENT, this.sendPayment)
    this.socket.on(Action.SET_BIO, this.setBio)
    this.socket.on(Action.DISCONNECT, this.disconnect)

    this.socket.on(Event.ON_AVATAR, this.onAvatar)
    this.socket.on(Event.ON_BLACKLIST, this.onBlacklist)
    this.socket.on(Event.ON_CHATS, this.onChats)
    this.socket.on(Event.ON_DISPLAY_NAME, this.onDisplayName)
    this.socket.on(Event.ON_HANDSHAKE_ADDRESS, this.onHandshakeAddress)
    this.socket.on(Event.ON_RECEIVED_REQUESTS, this.onReceivedRequests)
    this.socket.on(Event.ON_SENT_REQUESTS, this.onSentRequests)
    this.socket.on(Event.ON_BIO, this.onBio)
    this.socket.on(Event.ON_SEED_BACKUP, this.onSeedBackup)

    this.socket.on(Constants.Misc.IS_GUN_AUTH, this.isGunAuth)

    this.socket.on(Action.SET_LAST_SEEN_APP, this.setLastSeenApp)

    Object.values(Action).forEach(actionConstant =>
      this.socket.on(actionConstant, this.setLastSeenApp)
    )
  }

  /** @param {SimpleSocket} socket */
  encryptSocketInstance = socket => {
    const emit = encryptedEmit(socket)
    const on = encryptedOn(socket)

    return {
      /**
       * @type {SimpleSocket['on']}
       */
      on,
      /** @type {SimpleSocket['emit']} */
      emit
    }
  }

  /** @param {{ token: string }} body */
  setLastSeenApp = async body => {
    logger.info('setLastSeen Called')
    try {
      await throwOnInvalidToken(body.token)
      await API.Actions.setLastSeenApp()
      this.socket.emit(Action.SET_LAST_SEEN_APP, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (e) {
      this.socket.emit(Action.SET_LAST_SEEN_APP, {
        ok: false,
        msg: e.message,
        origBody: body
      })
    }
  }

  isGunAuth = () => {
    try {
      const isGunAuth = isAuthenticated()

      this.socket.emit(Constants.Misc.IS_GUN_AUTH, {
        ok: true,
        msg: {
          isGunAuth
        },
        origBody: {}
      })
    } catch (err) {
      this.socket.emit(Constants.Misc.IS_GUN_AUTH, {
        ok: false,
        msg: err.message,
        origBody: {}
      })
    }
  }

  /**
   * @param {Readonly<{ requestID: string , token: string }>} body
   */
  acceptRequest = async body => {
    try {
      const { requestID, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.acceptRequest(requestID, gun, user, mySEA)

      this.socket.emit(Action.ACCEPT_REQUEST, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.ACCEPT_REQUEST, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ publicKey: string , token: string }>} body
   */
  blacklist = async body => {
    try {
      const { publicKey, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.blacklist(publicKey, user)

      this.socket.emit(Action.BLACKLIST, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.BLACKLIST, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  onDisconnect = () => {
    this.connected = false
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  generateHandshakeNode = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      await API.Actions.generateHandshakeAddress()

      this.socket.emit(Action.GENERATE_NEW_HANDSHAKE_NODE, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.GENERATE_NEW_HANDSHAKE_NODE, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  generateOrderAddress = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      await API.Actions.generateOrderAddress(user)

      this.socket.emit('GENERATE_ORDER_ADDRESS', {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit('GENERATE_ORDER_ADDRESS', {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  initWall = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      await API.Actions.initWall()

      this.socket.emit('INIT_FEED_WALL', {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit('INIT_FEED_WALL', {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ recipientPublicKey: string , token: string }>} body
   */
  sendHandshakeRequest = async body => {
    try {
      if (Config.SHOW_LOG) {
        logger.info('\n')
        logger.info('------------------------------')
        logger.info('will now try to send a handshake request')
        logger.info('------------------------------')
        logger.info('\n')
      }

      const { recipientPublicKey, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.sendHandshakeRequest(
        recipientPublicKey,
        gun,
        user,
        mySEA
      )

      if (Config.SHOW_LOG) {
        logger.info('\n')
        logger.info('------------------------------')
        logger.info('handshake request successfuly sent')
        logger.info('------------------------------')
        logger.info('\n')
      }

      this.socket.emit(Action.SEND_HANDSHAKE_REQUEST, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      if (Config.SHOW_LOG) {
        logger.info('\n')
        logger.info('------------------------------')
        logger.info('handshake request send fail: ' + err.message)
        logger.info('------------------------------')
        logger.info('\n')
      }

      this.socket.emit(Action.SEND_HANDSHAKE_REQUEST, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ initialMsg: string , recipientPublicKey: string , token: string }>} body
   */
  sendHRWithInitialMsg = async body => {
    try {
      const { initialMsg, recipientPublicKey, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.sendHRWithInitialMsg(
        initialMsg,
        recipientPublicKey,
        gun,
        user,
        mySEA
      )

      this.socket.emit(Action.SEND_HANDSHAKE_REQUEST_WITH_INITIAL_MSG, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.SEND_HANDSHAKE_REQUEST_WITH_INITIAL_MSG, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ body: string , recipientPublicKey: string , token: string }>} reqBody
   */
  sendMessage = async reqBody => {
    try {
      const { body, recipientPublicKey, token } = reqBody

      await throwOnInvalidToken(token)

      this.socket.emit(Action.SEND_MESSAGE, {
        ok: true,
        msg: await API.Actions.sendMessage(
          recipientPublicKey,
          body,
          user,
          mySEA
        ),
        origBody: reqBody
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.SEND_MESSAGE, {
        ok: false,
        msg: err.message,
        origBody: reqBody
      })
    }
  }

  /**
   * @param {Readonly<{ uuid: string, recipientPub: string, amount: number, memo: string, token: string, feeLimit:number }>} reqBody
   */
  sendPayment = async reqBody => {
    try {
      const { recipientPub, amount, memo, feeLimit, token } = reqBody

      await throwOnInvalidToken(token)

      const preimage = await API.Actions.sendPayment(
        recipientPub,
        amount,
        memo,
        feeLimit
      )

      this.socket.emit(Action.SEND_PAYMENT, {
        ok: true,
        msg: preimage,
        origBody: reqBody
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.SEND_PAYMENT, {
        ok: false,
        msg: err.message,
        origBody: reqBody
      })
    }
  }

  /**
   * @param {Readonly<{ avatar: string|null , token: string }>} body
   */
  setAvatar = async body => {
    try {
      const { avatar, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.setAvatar(avatar, user)

      this.socket.emit(Action.SET_AVATAR, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.SET_AVATAR, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ displayName: string , token: string }>} body
   */
  setDisplayName = async body => {
    try {
      const { displayName, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.setDisplayName(displayName, user)

      this.socket.emit(Action.SET_DISPLAY_NAME, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.SET_DISPLAY_NAME, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  //////////////////////////////////////////////////////////////////////////////

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onAvatar = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      API.Events.onAvatar(avatar => {
        if (Config.SHOW_LOG) {
          logger.info('---avatar---')
          logger.info(avatar || 'null')
          logger.info('-----------------------')
        }

        this.socket.emit(Event.ON_AVATAR, {
          msg: avatar,
          ok: true,
          origBody: body
        })
      }, user)
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_AVATAR, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onBlacklist = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      API.Events.onBlacklist(blacklist => {
        if (Config.SHOW_LOG) {
          logger.info('---blacklist---')
          logger.info(blacklist.join(','))
          logger.info('-----------------------')
        }

        this.socket.emit(Event.ON_BLACKLIST, {
          msg: blacklist,
          ok: true,
          origBody: body
        })
      }, user)
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_BLACKLIST, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onChats = async body => {
    try {
      const { token } = body

      // logger.info('ON_CHATS', body)

      await throwOnInvalidToken(token)

      API.Events.onChats(chats => {
        if (Config.SHOW_LOG) {
          logger.info('---chats---')
          logger.info(JSON.stringify(chats))
          logger.info('-----------------------')
        }

        this.socket.emit(Event.ON_CHATS, {
          msg: chats,
          ok: true,
          origBody: body
        })
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_CHATS, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onDisplayName = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      API.Events.onDisplayName(displayName => {
        if (Config.SHOW_LOG) {
          logger.info('---displayName---')
          logger.info(displayName || 'null or empty string')
          logger.info('-----------------------')
        }

        this.socket.emit(Event.ON_DISPLAY_NAME, {
          msg: displayName,
          ok: true,
          origBody: body
        })
      }, user)
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_DISPLAY_NAME, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onHandshakeAddress = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      API.Events.onCurrentHandshakeAddress(addr => {
        if (Config.SHOW_LOG) {
          logger.info('---addr---')
          logger.info(addr || 'null or empty string')
          logger.info('-----------------------')
        }

        this.socket.emit(Event.ON_HANDSHAKE_ADDRESS, {
          ok: true,
          msg: addr,
          origBody: body
        })
      }, user)
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_HANDSHAKE_ADDRESS, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onReceivedRequests = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      API.Events.onSimplerReceivedRequests(receivedRequests => {
        this.socket.emit(Event.ON_RECEIVED_REQUESTS, {
          msg: receivedRequests,
          ok: true,
          origBody: body
        })
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_RECEIVED_REQUESTS, {
        msg: err.message,
        ok: false,
        origBody: body
      })
    }
  }

  onSentRequestsSubbed = false

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onSentRequests = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      if (!this.onSentRequestsSubbed) {
        this.onSentRequestsSubbed = true

        API.Events.onSimplerSentRequests(
          debounce(sentRequests => {
            // logger.info(
            //   `new Reqss in mediator: ${JSON.stringify(sentRequests)}`
            // )
            this.socket.emit(Event.ON_SENT_REQUESTS, {
              msg: sentRequests,
              ok: true,
              origBody: body
            })
          }, 1000)
        )
      }
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_SENT_REQUESTS, {
        msg: err.message,
        ok: false,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onBio = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      API.Events.onBio(bio => {
        this.socket.emit(Event.ON_BIO, {
          msg: bio,
          ok: true,
          origBody: body
        })
      }, user)
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_BIO, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ bio: string|null , token: string }>} body
   */
  setBio = async body => {
    try {
      const { bio, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.setBio(bio, user)

      this.socket.emit(Action.SET_BIO, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      logger.info(err)
      this.socket.emit(Action.SET_BIO, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /**
   * @param {Readonly<{ token: string }>} body
   */
  onSeedBackup = async body => {
    try {
      const { token } = body

      await throwOnInvalidToken(token)

      await API.Events.onSeedBackup(
        seedBackup => {
          this.socket.emit(Event.ON_SEED_BACKUP, {
            ok: true,
            msg: seedBackup,
            origBody: body
          })
        },
        user,
        mySEA
      )
    } catch (err) {
      logger.info(err)
      this.socket.emit(Event.ON_SEED_BACKUP, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }

  /** @param {Readonly<{ pub: string, token: string }>} body */
  disconnect = async body => {
    try {
      const { pub, token } = body

      await throwOnInvalidToken(token)

      await API.Actions.disconnect(pub)

      this.socket.emit(Action.DISCONNECT, {
        ok: true,
        msg: null,
        origBody: body
      })
    } catch (err) {
      this.socket.emit(Action.DISCONNECT, {
        ok: false,
        msg: err.message,
        origBody: body
      })
    }
  }
}

/**
 * Creates an user for gun. Returns a promise containing the public key of the
 * newly created user.
 * @param {string} alias
 * @param {string} pass
 * @throws {Error} If gun is authenticated or is in the process of
 * authenticating. Use `isAuthenticating()` and `isAuthenticated()` to check for
 * this first. It can also throw if the alias is already registered on gun.
 * @returns {Promise<string>}
 */
const register = async (alias, pass) => {
  if (isRegistering()) {
    throw new Error('Already registering.')
  }

  if (isAuthenticating()) {
    throw new Error(
      'Cannot register while gun is being authenticated (reminder: there should only be one user created for each node).'
    )
  }

  if (isAuthenticated()) {
    throw new Error(
      'Cannot register if gun is already authenticated (reminder: there should only be one user created for each node).'
    )
  }

  /**
   * Peers provided to gun.
   */
  const peers = Object.values(gun._.opt.peers)

  const theresPeers = peers.length > 0
  const atLeastOneIsConnected = peers.some(
    p => p.wire && p.wire.readyState === 1
  )

  if (theresPeers && !atLeastOneIsConnected) {
    throw new Error(
      'No connected to any peers for checking of duplicate aliases'
    )
  }

  if (theresPeers && atLeastOneIsConnected) {
    // this import is done here to avoid circular dependency hell
    const { timeout5 } = require('../contact-api/utils')

    let userData = await timeout5(
      new Promise(res => {
        gun.get(`~@${alias}`).once(ud => res(ud))
      })
    )

    if (userData) {
      throw new Error(
        'The given alias has been used before, use an unique alias instead.'
      )
    }

    await new Promise(res => setTimeout(res, 300))

    userData = await timeout5(
      new Promise(res => {
        gun.get(`~@${alias}`).once(ud => res(ud), {
          // https://github.com/amark/gun/pull/971#issue-438630761
          wait: 1500
        })
      })
    )

    if (userData) {
      throw new Error(
        'The given alias has been used before, use an unique alias instead. (Caught at 2nd try)'
      )
    }
  }

  _isRegistering = true

  /** @type {import('../contact-api/SimpleGUN').CreateAck} */
  const ack = await new Promise(res =>
    user.create(alias, pass, ack => res(ack))
  )

  // An empty ack object seems to be caused by a duplicate alias sign up
  if ('{}' === JSON.stringify(ack)) {
    throw new Error(
      'The given alias has been used before, use an unique alias instead. (Empty ack)'
    )
  }

  _isRegistering = false

  if (typeof ack.err === 'string') {
    throw new Error(ack.err)
  } else if (typeof ack.pub === 'string' || typeof user._.sea === 'object') {
    // OK
  } else {
    throw new Error('unknown error, ack: ' + JSON.stringify(ack))
  }

  // restart instances so write to user graph work, there's an issue with gun
  // (at least on node) where after initial user creation, writes to user graph
  // don't work
  instantiateGun()

  return authenticate(alias, pass).then(async pub => {
    await API.Actions.setDisplayName('anon' + pub.slice(0, 8), user)
    await API.Actions.generateHandshakeAddress()
    await API.Actions.generateOrderAddress(user)
    await API.Actions.initWall()
    await API.Actions.setBio('A little bit about myself.', user)
    return pub
  })
}

/**
 * @param {SimpleSocket} socket
 * @throws {Error} If gun is not authenticated or is in the process of
 * authenticating. Use `isAuthenticating()` and `isAuthenticated()` to check for
 * this first.
 * @returns {Mediator}
 */
const createMediator = socket => {
  // if (isAuthenticating() || !isAuthenticated()) {
  //   throw new Error("Gun must be authenticated to create a Mediator");
  // }

  return new Mediator(socket)
}

module.exports = {
  authenticate,
  logoff,
  createMediator,
  isAuthenticated,
  isAuthenticating,
  isRegistering,
  register,
  getGun,
  getUser,
  mySEA,
  getMySecret,
  freshGun,
  $$__SHOCKWALLET__ENCRYPTED__
}
