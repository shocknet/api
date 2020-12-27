/**
 * @prettier
 */
const debounce = require('lodash/debounce')
const logger = require('winston')
const {
  Constants: { ErrorCode },
  Schema,
  Utils: CommonUtils
} = require('shock-common')

const Key = require('../key')
const Utils = require('../utils')
/**
 * @typedef {import('../SimpleGUN').UserGUNNode} UserGUNNode
 * @typedef {import('../SimpleGUN').GUNNode} GUNNode
 * @typedef {import('../SimpleGUN').ISEA} ISEA
 * @typedef {import('../SimpleGUN').ListenerData} ListenerData
 * @typedef {import('shock-common').Schema.HandshakeRequest} HandshakeRequest
 * @typedef {import('shock-common').Schema.Message} Message
 * @typedef {import('shock-common').Schema.Outgoing} Outgoing
 * @typedef {import('shock-common').Schema.PartialOutgoing} PartialOutgoing
 * @typedef {import('shock-common').Schema.Chat} Chat
 * @typedef {import('shock-common').Schema.ChatMessage} ChatMessage
 * @typedef {import('shock-common').Schema.SimpleSentRequest} SimpleSentRequest
 * @typedef {import('shock-common').Schema.SimpleReceivedRequest} SimpleReceivedRequest
 */

const DEBOUNCE_WAIT_TIME = 500

/**
 * @param {(userToIncoming: Record<string, string>) => void} cb
 * @param {UserGUNNode} user Pass only for testing purposes.
 * @param {ISEA} SEA
 * @returns {void}
 */
const __onUserToIncoming = (cb, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const callb = debounce(cb, DEBOUNCE_WAIT_TIME)

  /** @type {Record<string, string>} */
  const userToIncoming = {}

  const mySecret = require('../../Mediator').getMySecret()

  user
    .get(Key.USER_TO_INCOMING)
    .map()
    .on(async (encryptedIncomingID, userPub) => {
      if (typeof encryptedIncomingID !== 'string') {
        if (encryptedIncomingID === null) {
          // on disconnect
          delete userToIncoming[userPub]
        } else {
          logger.error(
            'got a non string non null value inside user to incoming'
          )
        }
        return
      }

      if (encryptedIncomingID.length === 0) {
        logger.error('got an empty string value')
        return
      }

      const incomingID = await SEA.decrypt(encryptedIncomingID, mySecret)

      if (typeof incomingID === 'undefined') {
        logger.warn('could not decrypt incomingID inside __onUserToIncoming')
        return
      }

      userToIncoming[userPub] = incomingID

      callb(userToIncoming)
    })
}

/** @type {Set<(av: string|null) => void>} */
const avatarListeners = new Set()

/** @type {string|null} */
let currentAvatar = null

const getAvatar = () => currentAvatar

/** @param {string|null} av */
const setAvatar = av => {
  currentAvatar = av
  avatarListeners.forEach(l => l(currentAvatar))
}

let avatarSubbed = false

/**
 * @param {(avatar: string|null) => void} cb
 * @param {UserGUNNode} user Pass only for testing purposes.
 * @throws {Error} If user hasn't been auth.
 * @returns {() => void}
 */
const onAvatar = (cb, user) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  avatarListeners.add(cb)

  cb(currentAvatar)

  if (!avatarSubbed) {
    avatarSubbed = true
    user
      .get(Key.PROFILE_BINARY)
      .get(Key.AVATAR)
      .on(avatar => {
        if (typeof avatar === 'string' || avatar === null) {
          setAvatar(avatar)
        }
      })
  }

  return () => {
    avatarListeners.delete(cb)
  }
}

/**
 * @param {(blacklist: string[]) => void} cb
 * @param {UserGUNNode} user
 * @returns {void}
 */
const onBlacklist = (cb, user) => {
  /** @type {string[]} */
  const blacklist = []

  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const callb = debounce(cb, DEBOUNCE_WAIT_TIME)

  // Initial value if no items are in blacklist in gun
  callb(blacklist)

  user
    .get(Key.BLACKLIST)
    .map()
    .on(publicKey => {
      if (typeof publicKey === 'string' && publicKey.length > 0) {
        blacklist.push(publicKey)
        callb(blacklist)
      } else {
        logger.warn('Invalid public key received for blacklist')
      }
    })
}

/** @type {Set<(addr: string|null) => void>} */
const addressListeners = new Set()

/** @type {string|null} */
let currentAddress = null

const getHandshakeAddress = () => currentAddress

/** @param {string|null} addr */
const setAddress = addr => {
  currentAddress = addr
  addressListeners.forEach(l => l(currentAddress))
}

let addrSubbed = false

/**
 * @param {(currentHandshakeAddress: string|null) => void} cb
 * @param {UserGUNNode} user
 * @returns {() => void}
 */
const onCurrentHandshakeAddress = (cb, user) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  addressListeners.add(cb)

  cb(currentAddress)

  if (!addrSubbed) {
    addrSubbed = true

    user.get(Key.CURRENT_HANDSHAKE_ADDRESS).on(addr => {
      if (typeof addr !== 'string') {
        logger.error('expected handshake address to be an string')

        setAddress(null)

        return
      }

      setAddress(addr)
    })
  }

  return () => {
    addressListeners.delete(cb)
  }
}

/** @type {Set<(dn: string|null) => void>} */
const dnListeners = new Set()

/** @type {string|null} */
let currentDn = null

const getDisplayName = () => currentDn

/** @param {string|null} dn */
const setDn = dn => {
  currentDn = dn
  dnListeners.forEach(l => l(currentDn))
}

let dnSubbed = false

/**
 * @param {(displayName: string|null) => void} cb
 * @param {UserGUNNode} user Pass only for testing purposes.
 * @throws {Error} If user hasn't been auth.
 * @returns {() => void}
 */
const onDisplayName = (cb, user) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  cb(currentDn)

  dnListeners.add(cb)

  if (!dnSubbed) {
    dnSubbed = true
    user
      .get(Key.PROFILE)
      .get(Key.DISPLAY_NAME)
      .on(displayName => {
        if (typeof displayName === 'string' || displayName === null) {
          setDn(displayName)
        }
      })
  }

  return () => {
    dnListeners.delete(cb)
  }
}

/**
 * @param {(messages: Record<string, Message>) => void} cb
 * @param {string} userPK Public key of the user from whom the incoming
 * messages will be obtained.
 * @param {string} incomingFeedID ID of the outgoing feed from which the
 * incoming messages will be obtained.
 * @param {GUNNode} gun (Pass only for testing purposes)
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {void}
 */
const onIncomingMessages = (cb, userPK, incomingFeedID, gun, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const callb = debounce(cb, DEBOUNCE_WAIT_TIME)

  const otherUser = gun.user(userPK)

  /**
   * @type {Record<string, Message>}
   */
  const messages = {}

  callb(messages)

  otherUser
    .get(Key.OUTGOINGS)
    .get(incomingFeedID)
    .get(Key.MESSAGES)
    .map()
    .on(async (data, key) => {
      if (!Schema.isMessage(data)) {
        logger.warn('non-message received')
        return
      }

      /** @type {string} */
      const recipientEpub = await Utils.pubToEpub(userPK)

      const secret = await SEA.secret(recipientEpub, user._.sea)

      let { body } = data
      body = await SEA.decrypt(body, secret)

      messages[key] = {
        body,
        timestamp: data.timestamp
      }

      callb(messages)
    })
}

/**
 * @typedef {Record<string, Outgoing|null>} Outgoings
 * @typedef {(outgoings: Outgoings) => void} OutgoingsListener
 */

/**
 * @type {Outgoings}
 */
let currentOutgoings = {}

const getCurrentOutgoings = () => currentOutgoings

/** @type {Set<OutgoingsListener>} */
const outgoingsListeners = new Set()

outgoingsListeners.add(o => {
  const values = Object.values(o)
  const nulls = values.filter(x => x === null).length
  const nonNulls = values.length - nulls

  logger.info(`new outgoings, ${nulls} nulls and ${nonNulls} nonNulls`)
})

const notifyOutgoingsListeners = () => {
  outgoingsListeners.forEach(l => l(currentOutgoings))
}

let outSubbed = false

/**
 * @param {OutgoingsListener} cb
 * @returns {() => void}
 */
const onOutgoing = cb => {
  outgoingsListeners.add(cb)
  cb(currentOutgoings)

  if (!outSubbed) {
    const user = require('../../Mediator').getUser()
    user.get(Key.OUTGOINGS).open(
      debounce(async data => {
        try {
          if (typeof data !== 'object' || data === null) {
            currentOutgoings = {}
            notifyOutgoingsListeners()
            return
          }

          /** @type {Record<string, Outgoing|null>} */
          const newOuts = {}

          const SEA = require('../../Mediator').mySEA
          const mySecret = await Utils.mySecret()

          await CommonUtils.asyncForEach(
            Object.entries(data),
            async ([id, out]) => {
              if (typeof out !== 'object') {
                return
              }

              if (out === null) {
                newOuts[id] = null
                return
              }

              const { with: encPub, messages } = out

              if (typeof encPub !== 'string') {
                return
              }

              const pub = await SEA.decrypt(encPub, mySecret)

              if (!newOuts[id]) {
                newOuts[id] = {
                  with: pub,
                  messages: {}
                }
              }

              const ourSec = await SEA.secret(
                await Utils.pubToEpub(pub),
                user._.sea
              )

              if (typeof messages === 'object' && messages !== null) {
                await CommonUtils.asyncForEach(
                  Object.entries(messages),
                  async ([mid, msg]) => {
                    if (typeof msg === 'object' && msg !== null) {
                      if (
                        typeof msg.body === 'string' &&
                        typeof msg.timestamp === 'number'
                      ) {
                        const newOut = newOuts[id]
                        if (!newOut) {
                          return
                        }
                        newOut.messages[mid] = {
                          body: await SEA.decrypt(msg.body, ourSec),
                          timestamp: msg.timestamp
                        }
                      }
                    }
                  }
                )
              }
            }
          )

          currentOutgoings = newOuts
          notifyOutgoingsListeners()
        } catch (e) {
          logger.info('--------------------------')
          logger.info('Events -> onOutgoing')
          logger.info(e)
          logger.info('--------------------------')
        }
      }, 400)
    )

    outSubbed = true
  }

  return () => {
    outgoingsListeners.delete(cb)
  }
}
////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {(chats: Chat[]) => void} ChatsListener
 */

/** @type {Chat[]} */
let currentChats = []

const getChats = () => currentChats

/** @type {Set<ChatsListener>} */
const chatsListeners = new Set()

chatsListeners.add(c => {
  logger.info(`Chats: ${c.length}`)
})

const notifyChatsListeners = () => {
  chatsListeners.forEach(l => l(currentChats))
}

const processChats = debounce(() => {
  const Streams = require('../streams')
  const pubToAvatar = Streams.getPubToAvatar()
  const pubToDn = Streams.getPubToDn()
  const pubToLastSeenApp = Streams.getPubToLastSeenApp()
  const existingOutgoings = /** @type {[string, Outgoing][]} */ (Object.entries(
    getCurrentOutgoings()
  ).filter(([_, o]) => o !== null))
  const pubToFeed = Streams.getPubToFeed()

  /** @type {Chat[]} */
  const newChats = []

  for (const [outID, out] of existingOutgoings) {
    if (typeof pubToAvatar[out.with] === 'undefined') {
      // eslint-disable-next-line no-empty-function
      Streams.onAvatar(() => {}, out.with)()
    }
    if (typeof pubToDn[out.with] === 'undefined') {
      // eslint-disable-next-line no-empty-function
      Streams.onDisplayName(() => {}, out.with)()
    }
    if (typeof pubToLastSeenApp[out.with] === 'undefined') {
      // eslint-disable-next-line no-empty-function
      Streams.onPubToLastSeenApp(() => {}, out.with)()
    }

    /** @type {ChatMessage[]} */
    let msgs = Object.entries(out.messages)
      .map(([mid, m]) => ({
        id: mid,
        outgoing: true,
        body: m.body,
        timestamp: m.timestamp
      }))
      // filter out null messages
      .filter(m => typeof m.body === 'string')

    const incoming = pubToFeed[out.with]

    if (Array.isArray(incoming)) {
      msgs = [...msgs, ...incoming]
    }

    /** @type {Chat} */
    const chat = {
      recipientPublicKey: out.with,
      didDisconnect: pubToFeed[out.with] === 'disconnected',
      id: out.with + outID,
      messages: msgs,
      recipientAvatar: null,
      recipientDisplayName: null,
      lastSeenApp: pubToLastSeenApp[out.with] || null
    }

    newChats.push(chat)
  }

  currentChats = newChats.filter(
    c =>
      Array.isArray(pubToFeed[c.recipientPublicKey]) ||
      pubToFeed[c.recipientPublicKey] === 'disconnected'
  )

  notifyChatsListeners()
}, 750)

let onChatsSubbed = false

/**
 * Massages all of the more primitive data structures into a more manageable
 * 'Chat' paradigm.
 * @param {ChatsListener} cb
 * @returns {() => void}
 */
const onChats = cb => {
  if (!chatsListeners.add(cb)) {
    throw new Error('Tried to subscribe twice')
  }
  cb(currentChats)

  if (!onChatsSubbed) {
    const Streams = require('../streams')
    onOutgoing(processChats)
    Streams.onAvatar(processChats)
    Streams.onDisplayName(processChats)
    Streams.onPubToFeed(processChats)
    Streams.onPubToLastSeenApp(processChats)
    onChatsSubbed = true
  }

  return () => {
    if (!chatsListeners.delete(cb)) {
      throw new Error('Tried to unsubscribe twice')
    }
  }
}

/** @type {string|null} */
let currentBio = null

/**
 * @param {(bio: string|null) => void} cb
 * @param {UserGUNNode} user Pass only for testing purposes.
 * @throws {Error} If user hasn't been auth.
 * @returns {void}outgoingsListeners.forEach()
 */
const onBio = (cb, user) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const callb = debounce(cb, DEBOUNCE_WAIT_TIME)
  // Initial value if avvatar is undefined in gun
  callb(currentBio)

  user.get(Key.BIO).on(bio => {
    if (typeof bio === 'string' || bio === null) {
      currentBio = bio
      callb(bio)
    }
  })
}

/** @type {string|null} */
let currentSeedBackup = null

/**
 * @param {(seedBackup: string|null) => void} cb
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @throws {Error} If user hasn't been auth.
 * @returns {void}
 */
const onSeedBackup = (cb, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const mySecret = require('../../Mediator').getMySecret()

  const callb = debounce(cb, DEBOUNCE_WAIT_TIME)
  callb(currentSeedBackup)

  user.get(Key.SEED_BACKUP).on(async seedBackup => {
    if (typeof seedBackup === 'string') {
      currentSeedBackup = await SEA.decrypt(seedBackup, mySecret)
      callb(currentSeedBackup)
    }
  })
}

/**
 * @typedef {object} ProcessedMessage
 * @prop {string} body
 * @prop {boolean} outgoing
 * @prop {number} timestamp
 */
/**
 * @typedef {object} ProcessedChat
 * @prop {string} with
 * @prop {Record<string,ProcessedMessage>} messages
 */
/**
 * @typedef {Record<string,(ProcessedChat|null)>} ProcessedChats
 * @typedef {(chats:ProcessedChats|null)=>void} ChatBotsChatsListener
 */
/** @type {ProcessedChats|null} */
let currentChatBotsChats = null

const getCurrentChatBotsChats = () => currentChatBotsChats

/** @type {Set<ChatBotsChatsListener>} */
const chatBotsChatsListeners = new Set()

const notifyChatBotsChatsListeners = () => {
  chatBotsChatsListeners.forEach(l => l(currentChatBotsChats))
}

let chatBotsChatsSubbed = false
let chatBotsChatsSubbing = false
/**
 * @param {(currentChatBotsChats:ProcessedChats|null) => void} cb
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @throws {Error} If user hasn't been auth.
 * @returns {()=>void}
 */
const onChatBotsChats = (cb, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }
  chatBotsChatsListeners.add(cb)
  const deletecb = () => {
    chatBotsChatsListeners.delete(cb)
  }
  cb(currentChatBotsChats)
  const mySecret = require('../../Mediator').getMySecret()

  if (chatBotsChatsSubbed || chatBotsChatsSubbing) {
    return deletecb
  }
  chatBotsChatsSubbing = true
  user.get(Key.CHAT_BOTS_CHATS).open(
    debounce(async botsChats => {
      try {
        if (!botsChats || typeof botsChats !== 'object') {
          return
        }

        /**
         * @type {ProcessedChats}
         */
        const newChats = {}
        await CommonUtils.asyncForEach(
          Object.entries(botsChats),
          async ([botId, botChat]) => {
            if (typeof botChat !== 'object') {
              return
            }

            if (botChat === null) {
              newChats[botId] = null
              return
            }

            const { messages } = botChat

            if (!newChats[botId]) {
              newChats[botId] = {
                with: botId,
                messages: {}
              }
            }

            if (!messages || typeof messages !== 'object') {
              return
            }
            await CommonUtils.asyncForEach(
              Object.entries(messages),
              async ([messageId, message]) => {
                if (typeof message !== 'object' || message === null) {
                  return
                }
                if (
                  typeof message.body !== 'string' ||
                  typeof message.timestamp !== 'number' ||
                  typeof message.outgoing !== 'boolean'
                ) {
                  return
                }
                const newChat = newChats[botId]
                if (!newChat) {
                  return
                }
                newChat.messages[messageId] = {
                  body: await SEA.decrypt(message.body, mySecret),
                  timestamp: message.timestamp,
                  outgoing: message.outgoing
                }
              }
            )
          }
        )
        currentChatBotsChats = newChats
        notifyChatBotsChatsListeners()
      } catch (err) {
        logger.info('--------------------------')
        logger.info('Events -> onChatBotsChats')
        logger.info(err)
        logger.info('--------------------------')
      }
    }, 400)
  )
  chatBotsChatsSubbed = true
  return deletecb
}

module.exports = {
  __onUserToIncoming,
  onAvatar,
  onBlacklist,
  onCurrentHandshakeAddress,
  onDisplayName,
  onIncomingMessages,
  onOutgoing,
  getCurrentOutgoings,
  onSimplerReceivedRequests: require('./onReceivedReqs').onReceivedReqs,
  onSimplerSentRequests: require('./onSentReqs').onSentReqs,
  getCurrentSentReqs: require('./onSentReqs').getCurrentSentReqs,
  getCurrentReceivedReqs: require('./onReceivedReqs').getReceivedReqs,
  onBio,
  onSeedBackup,
  onChats,
  getAvatar,
  getDisplayName,
  getHandshakeAddress,
  getChats,
  getCurrentChatBotsChats,
  onChatBotsChats
}
