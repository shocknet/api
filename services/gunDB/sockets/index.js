/**
 * @format
 */

const logger = require('winston')
const Common = require('shock-common')
const uuidv4 = require('uuid/v4')

const { getGun, getUser, isAuthenticated } = require('../Mediator')
const { deepDecryptIfNeeded } = require('../rpc')
const Subscriptions = require('./subscriptions')
const GunEvents = require('../contact-api/events')
const {
  encryptedEmit,
  encryptedOn,
  encryptedCallback
} = require('../../../utils/ECC/socket')
const auth = require('../../auth/auth')

const ALLOWED_GUN_METHODS = [
  'map',
  'map.on',
  'on',
  'once',
  'load',
  'then',
  'open'
]

/**
 * @typedef {import('../contact-api/SimpleGUN').ValidDataValue} ValidDataValue
 */

/**
 * @typedef {(data: ValidDataValue, key?: string, _msg?: any, event?: any) => (void | Promise<void>)} GunListener
 * @typedef {{ reconnect: boolean, token: string }} SubscriptionOptions
 */

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
 * @param {string} root
 */
const getNode = root => {
  if (root === '$gun') {
    return getGun()
  }

  if (root === '$user') {
    return getUser()
  }

  return getGun().user(root)
}

/**
 * @param {import("../contact-api/SimpleGUN").GUNNode} node
 * @param {string} path
 */
const getGunQuery = (node, path) => {
  const bits = path.split('>')
  const query = bits.reduce((gunQuery, bit) => gunQuery.get(bit), node)
  return query
}

/**
 * Executes a GunDB query call using the specified method
 * @param {any} query
 * @param {string} method
 * @param {GunListener} listener
 */
const executeGunQuery = (query, method, listener) => {
  if (!ALLOWED_GUN_METHODS.includes(method)) {
    throw {
      field: 'method',
      message: `Invalid GunDB method specified (${method}). `
    }
  }

  if (method === 'on') {
    return query.on(listener)
  }

  if (method === 'open') {
    return query.open(listener)
  }

  if (method === 'map.on') {
    return query.map().on(listener)
  }

  if (method === 'map.once') {
    return query.map().once(listener)
  }
}

/**
 * @param {Object} queryData
 * @param {(eventName: string, ...args: any[]) => Promise<void>} queryData.emit
 * @param {string} queryData.publicKeyForDecryption
 * @param {string} queryData.subscriptionId
 * @param {string} queryData.deviceId
 * @returns {GunListener}
 */
const queryListenerCallback = ({
  emit,
  publicKeyForDecryption,
  subscriptionId,
  deviceId
}) => async (data, key, _msg, event) => {
  try {
    const subscription = Subscriptions.get({
      deviceId,
      subscriptionId
    })
    if (subscription && !subscription.unsubscribe && event) {
      Subscriptions.attachUnsubscribe({
        deviceId,
        subscriptionId,
        unsubscribe: () => event.off()
      })
    }
    const eventName = `query:data`
    if (publicKeyForDecryption) {
      const decData = await deepDecryptIfNeeded(data, publicKeyForDecryption)
      emit(eventName, { subscriptionId, response: { data: decData, key } })
      return
    }

    emit(eventName, { subscriptionId, response: { data, key } })
  } catch (err) {
    logger.error(`Error for gun rpc socket: ${err.message}`)
  }
}

/**
 * @param {Object} GunSocketOptions
 * @param {() => (import('./subscriptions').Unsubscribe | void)} GunSocketOptions.handler
 * @param {string} GunSocketOptions.subscriptionId
 * @param {string} GunSocketOptions.encryptionId
 * @param {import('socket.io').Socket} GunSocketOptions.socket
 * @returns {(options: SubscriptionOptions, response: (error?: any, data?: any) => void) => Promise<void>}
 */
const wrap = ({ handler, subscriptionId, encryptionId, socket }) => async (
  { reconnect, token },
  response
) => {
  try {
    logger.info('Subscribe function executing...')
    if (!isAuthenticated()) {
      logger.warn('GunDB is not yet authenticated')
      socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
      return
    }

    const callback = encryptedCallback(socket, response)
    const emit = encryptedEmit(socket)
    const subscription = Subscriptions.get({
      deviceId: encryptionId,
      subscriptionId
    })

    if (subscription && !reconnect) {
      const error = {
        field: 'subscription',
        message:
          "You're already subscribed to this event, you can re-subscribe again by setting 'reconnect' to true "
      }
      logger.error('Duplicate subscription:', error)
      callback(error)
      return
    }

    if (subscription && reconnect) {
      if (subscription.unsubscribe) {
        subscription.unsubscribe()
      }

      Subscriptions.remove({
        deviceId: encryptionId,
        subscriptionId
      })
    }

    if (!subscription || reconnect) {
      const isAuth = await isValidToken(token)

      if (!isAuth) {
        logger.warn('invalid token specified')
        emit(Common.Constants.ErrorCode.NOT_AUTH)
        return
      }

      const unsubscribe = handler()

      if (unsubscribe) {
        Subscriptions.attachUnsubscribe({
          deviceId: encryptionId,
          subscriptionId,
          unsubscribe
        })
      }
    }

    callback(null, {
      message: 'Subscribed successfully!',
      success: true
    })
  } catch (error) {
    logger.error('Socket wrapper error:', error)
  }
}

/** @param {import('socket.io').Socket} socket */
const startSocket = socket => {
  try {
    const emit = encryptedEmit(socket)
    const on = encryptedOn(socket)
    const { encryptionId } = socket.handshake.auth

    if (!isAuthenticated()) {
      logger.warn('GunDB is not yet authenticated')
      socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
    }

    on('subscribe:query', ({ $shock, publicKey }, response) => {
      const subscriptionId = uuidv4()
      try {
        if (!isAuthenticated()) {
          socket.emit(Common.Constants.ErrorCode.NOT_AUTH)
          return
        }

        const [root, path, method] = $shock.split('::')
        const socketCallback = encryptedCallback(socket, response)

        if (!ALLOWED_GUN_METHODS.includes(method)) {
          socketCallback(
            `Invalid method for gun rpc call: ${method}, query: ${$shock}`
          )
          return
        }

        Subscriptions.add({
          deviceId: encryptionId,
          subscriptionId
        })

        const queryCallback = queryListenerCallback({
          emit,
          publicKeyForDecryption: publicKey,
          subscriptionId,
          deviceId: encryptionId
        })

        socketCallback(null, {
          subscriptionId
        })

        const node = getNode(root)
        const query = getGunQuery(node, path)

        executeGunQuery(query, method, queryCallback)
      } catch (error) {
        emit(`query:error`, { subscriptionId, response: { data: error } })
      }
    })

    const onChats = () => {
      return GunEvents.onChats(chats => {
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

        emit('chats', processed)
      })
    }

    on(
      'subscribe:chats',
      wrap({
        handler: onChats,
        encryptionId,
        subscriptionId: 'chats',
        socket
      })
    )

    const onSentRequests = () => {
      return GunEvents.onSimplerSentRequests(sentReqs => {
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
        emit('sentRequests', processed)
      })
    }

    on(
      'subscribe:sentRequests',
      wrap({
        handler: onSentRequests,
        encryptionId,
        subscriptionId: 'sentRequests',
        socket
      })
    )

    const onReceivedRequests = () => {
      return GunEvents.onSimplerReceivedRequests(receivedReqs => {
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

        emit('receivedRequests', processed)
      })
    }

    on(
      'subscribe:receivedRequests',
      wrap({
        handler: onReceivedRequests,
        encryptionId,
        subscriptionId: 'receivedRequests',
        socket
      })
    )

    on('unsubscribe', ({ subscriptionId }, response) => {
      const callback = encryptedCallback(socket, response)
      Subscriptions.remove({ deviceId: encryptionId, subscriptionId })
      callback(null, {
        message: 'Unsubscribed successfully!',
        success: true
      })
    })

    socket.on('disconnect', () => {
      Subscriptions.removeDevice({ deviceId: encryptionId })
    })
  } catch (err) {
    logger.error('GUNRPC: ' + err.message)
  }
}

module.exports = startSocket
