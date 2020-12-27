/**
 * @format
 */
const uuidv1 = require('uuid/v1')
const logger = require('winston')
const Common = require('shock-common')
const { Constants, Schema } = Common
const Gun = require('gun')

const { ErrorCode } = Constants

const {
  sendPaymentV2Invoice,
  decodePayReq
} = require('../../../utils/lightningServices/v2')

/**
 * @typedef {import('../../../utils/lightningServices/types').PaymentV2} PaymentV2
 */

const Getters = require('./getters')
const Key = require('./key')
const Utils = require('./utils')

/**
 * @typedef {import('./SimpleGUN').GUNNode} GUNNode
 * @typedef {import('./SimpleGUN').ISEA} ISEA
 * @typedef {import('./SimpleGUN').UserGUNNode} UserGUNNode
 * @typedef {import('shock-common').Schema.HandshakeRequest} HandshakeRequest
 * @typedef {import('shock-common').Schema.StoredRequest} StoredReq
 * @typedef {import('shock-common').Schema.Message} Message
 * @typedef {import('shock-common').Schema.Outgoing} Outgoing
 * @typedef {import('shock-common').Schema.PartialOutgoing} PartialOutgoing
 * @typedef {import('shock-common').Schema.Order} Order
 * @typedef {import('./SimpleGUN').Ack} Ack
 */

/**
 * Create a an outgoing feed. The feed will have an initial special acceptance
 * message. Returns a promise that resolves to the id of the newly-created
 * outgoing feed.
 *
 * If an outgoing feed is already created for the recipient, then returns the id
 * of that one.
 * @param {string} withPublicKey Public key of the intended recipient of the
 * outgoing feed that will be created.
 * @throws {Error} If the outgoing feed cannot be created or if the initial
 * message for it also cannot be created. These errors aren't coded as they are
 * not meant to be caught outside of this module.
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {Promise<string>}
 */
const __createOutgoingFeed = async (withPublicKey, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const mySecret = require('../Mediator').getMySecret()
  const encryptedForMeRecipientPub = await SEA.encrypt(withPublicKey, mySecret)
  const ourSecret = await SEA.secret(
    await Utils.pubToEpub(withPublicKey),
    user._.sea
  )

  const maybeOutgoingID = await Utils.recipientToOutgoingID(withPublicKey)

  let outgoingFeedID = ''

  // if there was no stored outgoing, create an outgoing feed
  if (typeof maybeOutgoingID !== 'string') {
    /** @type {PartialOutgoing} */
    const newPartialOutgoingFeed = {
      with: encryptedForMeRecipientPub
    }

    /** @type {string} */
    const newOutgoingFeedID = await new Promise((res, rej) => {
      const _outFeedNode = user
        .get(Key.OUTGOINGS)
        //@ts-ignore
        .set(newPartialOutgoingFeed, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res(_outFeedNode._.get)
          }
        })
    })

    if (typeof newOutgoingFeedID !== 'string') {
      throw new TypeError('typeof newOutgoingFeedID !== "string"')
    }

    /** @type {Message} */
    const initialMsg = {
      body: await SEA.encrypt(Constants.Misc.INITIAL_MSG, ourSecret),
      timestamp: Date.now()
    }

    await new Promise((res, rej) => {
      user
        .get(Key.OUTGOINGS)
        .get(newOutgoingFeedID)
        .get(Key.MESSAGES)
        //@ts-ignore
        .set(initialMsg, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        })
    })

    const encryptedForMeNewOutgoingFeedID = await SEA.encrypt(
      newOutgoingFeedID,
      mySecret
    )

    await new Promise((res, rej) => {
      user
        .get(Key.RECIPIENT_TO_OUTGOING)
        .get(withPublicKey)
        .put(encryptedForMeNewOutgoingFeedID, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(Error(ack.err))
          } else {
            res()
          }
        })
    })

    outgoingFeedID = newOutgoingFeedID
  }

  // otherwise decrypt stored outgoing
  else {
    outgoingFeedID = maybeOutgoingID
  }

  if (typeof outgoingFeedID === 'undefined') {
    throw new TypeError(
      '__createOutgoingFeed() -> typeof outgoingFeedID === "undefined"'
    )
  }

  if (typeof outgoingFeedID !== 'string') {
    throw new TypeError(
      '__createOutgoingFeed() -> expected outgoingFeedID to be an string'
    )
  }

  if (outgoingFeedID.length === 0) {
    throw new TypeError(
      '__createOutgoingFeed() -> expected outgoingFeedID to be a populated string.'
    )
  }

  return outgoingFeedID
}

/**
 * Given a request's ID, that should be found on the user's current handshake
 * node, accept the request by creating an outgoing feed intended for the
 * requestor, then encrypting and putting the id of this newly created outgoing
 * feed on the response prop of the request.
 * @param {string} requestID The id for the request to accept.
 * @param {GUNNode} gun
 * @param {UserGUNNode} user Pass only for testing purposes.
 * @param {ISEA} SEA
 * @param {typeof __createOutgoingFeed} outgoingFeedCreator Pass only
 * for testing. purposes.
 * @throws {Error} Throws if trying to accept an invalid request, or an error on
 * gun's part.
 * @returns {Promise<void>}
 */
const acceptRequest = async (
  requestID,
  gun,
  user,
  SEA,
  outgoingFeedCreator = __createOutgoingFeed
) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  const handshakeAddress = await Utils.tryAndWait(async (_, user) => {
    const addr = await user.get(Key.CURRENT_HANDSHAKE_ADDRESS).then()

    if (typeof addr !== 'string') {
      throw new TypeError("typeof addr !== 'string'")
    }

    return addr
  })

  const {
    response: encryptedForUsIncomingID,
    from: senderPublicKey
  } = await Utils.tryAndWait(async gun => {
    const hr = await gun
      .get(Key.HANDSHAKE_NODES)
      .get(handshakeAddress)
      .get(requestID)
      .then()

    if (!Schema.isHandshakeRequest(hr)) {
      throw new Error(ErrorCode.TRIED_TO_ACCEPT_AN_INVALID_REQUEST)
    }

    return hr
  })

  /** @type {string} */
  const requestorEpub = await Utils.pubToEpub(senderPublicKey)

  const ourSecret = await SEA.secret(requestorEpub, user._.sea)
  if (typeof ourSecret !== 'string') {
    throw new TypeError("typeof ourSecret !== 'string'")
  }

  const incomingID = await SEA.decrypt(encryptedForUsIncomingID, ourSecret)
  if (typeof incomingID !== 'string') {
    throw new TypeError("typeof incomingID !== 'string'")
  }

  const newlyCreatedOutgoingFeedID = await outgoingFeedCreator(
    senderPublicKey,
    user,
    SEA
  )

  const mySecret = require('../Mediator').getMySecret()
  const encryptedForMeIncomingID = await SEA.encrypt(incomingID, mySecret)

  await new Promise((res, rej) => {
    user
      .get(Key.USER_TO_INCOMING)
      .get(senderPublicKey)
      .put(encryptedForMeIncomingID, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })

  ////////////////////////////////////////////////////////////////////////////
  // NOTE: perform non-reversable actions before destructive actions
  // In case any of the non-reversable actions reject.
  // In this case, writing to the response is the non-revesarble op.
  ////////////////////////////////////////////////////////////////////////////

  const encryptedForUsOutgoingID = await SEA.encrypt(
    newlyCreatedOutgoingFeedID,
    ourSecret
  )

  await new Promise((res, rej) => {
    gun
      .get(Key.HANDSHAKE_NODES)
      .get(handshakeAddress)
      .get(requestID)
      .put(
        {
          response: encryptedForUsOutgoingID
        },
        ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        }
      )
  })
}

/**
 * @param {string} user
 * @param {string} pass
 * @param {UserGUNNode} userNode
 */
const authenticate = (user, pass, userNode) =>
  new Promise((resolve, reject) => {
    if (typeof user !== 'string') {
      throw new TypeError('expected user to be of type string')
    }

    if (typeof pass !== 'string') {
      throw new TypeError('expected pass to be of type string')
    }

    if (user.length === 0) {
      throw new TypeError('expected user to have length greater than zero')
    }

    if (pass.length === 0) {
      throw new TypeError('expected pass to have length greater than zero')
    }

    if (typeof userNode.is === 'undefined') {
      throw new Error(ErrorCode.ALREADY_AUTH)
    }

    userNode.auth(user, pass, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        reject(new Error(ack.err))
      } else if (!userNode.is) {
        reject(new Error('authentication failed'))
      } else {
        resolve()
      }
    })
  })

/**
 * @param {string} publicKey
 * @param {UserGUNNode} user Pass only for testing.
 * @throws {Error} If there's an error saving to the blacklist.
 * @returns {Promise<void>}
 */
const blacklist = (publicKey, user) =>
  new Promise((resolve, reject) => {
    if (!user.is) {
      throw new Error(ErrorCode.NOT_AUTH)
    }

    user.get(Key.BLACKLIST).set(publicKey, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        reject(new Error(ack.err))
      } else {
        resolve()
      }
    })
  })

/**
 * @returns {Promise<void>}
 */
const generateHandshakeAddress = async () => {
  const gun = require('../Mediator').getGun()
  const user = require('../Mediator').getUser()

  const address = uuidv1()

  await new Promise((res, rej) => {
    user.get(Key.CURRENT_HANDSHAKE_ADDRESS).put(address, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        rej(new Error(ack.err))
      } else {
        res()
      }
    })
  })

  await new Promise((res, rej) => {
    gun
      .get(Key.HANDSHAKE_NODES)
      .get(address)
      .put({ unused: 0 }, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })
}

/**
 *
 * @param {string} pub
 * @throws {Error}
 * @returns {Promise<void>}
 */
const cleanup = async pub => {
  const user = require('../Mediator').getUser()

  const outGoingID = await Utils.recipientToOutgoingID(pub)

  const promises = []

  promises.push(
    new Promise((res, rej) => {
      user
        .get(Key.USER_TO_INCOMING)
        .get(pub)
        .put(null, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        })
    })
  )

  promises.push(
    new Promise((res, rej) => {
      user
        .get(Key.RECIPIENT_TO_OUTGOING)
        .get(pub)
        .put(null, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        })
    })
  )

  promises.push(
    new Promise((res, rej) => {
      user
        .get(Key.USER_TO_LAST_REQUEST_SENT)
        .get(pub)
        .put(null, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        })
    })
  )

  if (outGoingID) {
    promises.push(
      new Promise((res, rej) => {
        user
          .get(Key.OUTGOINGS)
          .get(outGoingID)
          .put(null, ack => {
            if (ack.err && typeof ack.err !== 'number') {
              rej(new Error(ack.err))
            } else {
              res()
            }
          })
      })
    )
  }

  await Promise.all(promises)
}

/**
 * @param {string} recipientPublicKey
 * @param {GUNNode} gun
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @throws {Error|TypeError}
 * @returns {Promise<void>}
 */
const sendHandshakeRequest = async (recipientPublicKey, gun, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  await cleanup(recipientPublicKey)

  if (typeof recipientPublicKey !== 'string') {
    throw new TypeError(
      `recipientPublicKey is not string, got: ${typeof recipientPublicKey}`
    )
  }

  if (recipientPublicKey.length === 0) {
    throw new TypeError('recipientPublicKey is an string of length 0')
  }

  if (recipientPublicKey === user.is.pub) {
    throw new Error('Do not send a request to yourself')
  }

  logger.info('sendHR() -> before recipientEpub')

  /** @type {string} */
  const recipientEpub = await Utils.pubToEpub(recipientPublicKey)

  logger.info('sendHR() -> before mySecret')

  const mySecret = require('../Mediator').getMySecret()
  logger.info('sendHR() -> before ourSecret')
  const ourSecret = await SEA.secret(recipientEpub, user._.sea)

  // check if successful handshake is present

  logger.info('sendHR() -> before alreadyHandshaked')

  /** @type {boolean} */
  const alreadyHandshaked = await Utils.successfulHandshakeAlreadyExists(
    recipientPublicKey
  )

  if (alreadyHandshaked) {
    throw new Error(ErrorCode.ALREADY_HANDSHAKED)
  }

  logger.info('sendHR() -> before maybeLastRequestIDSentToUser')

  // check that we have already sent a request to this user, on his current
  // handshake node
  const maybeLastRequestIDSentToUser = await Utils.tryAndWait((_, user) =>
    user
      .get(Key.USER_TO_LAST_REQUEST_SENT)
      .get(recipientPublicKey)
      .then()
  )

  logger.info('sendHR() -> before currentHandshakeAddress')

  const currentHandshakeAddress = await Utils.tryAndWait(
    gun =>
      Common.Utils.makePromise(res => {
        gun
          .user(recipientPublicKey)
          .get(Key.CURRENT_HANDSHAKE_ADDRESS)
          .once(
            data => {
              res(data)
            },
            { wait: 1000 }
          )
      }),
    data => typeof data !== 'string'
  )

  if (typeof currentHandshakeAddress !== 'string') {
    throw new TypeError(
      'expected current handshake address found on recipients user node to be an string'
    )
  }

  if (typeof maybeLastRequestIDSentToUser === 'string') {
    if (maybeLastRequestIDSentToUser.length < 5) {
      throw new TypeError(
        'sendHandshakeRequest() -> maybeLastRequestIDSentToUser.length < 5'
      )
    }

    const lastRequestIDSentToUser = maybeLastRequestIDSentToUser

    logger.info('sendHR() -> before alreadyContactedOnCurrHandshakeNode')

    const hrInHandshakeNode = await Utils.tryAndWait(
      gun =>
        new Promise(res => {
          gun
            .get(Key.HANDSHAKE_NODES)
            .get(currentHandshakeAddress)
            .get(lastRequestIDSentToUser)
            .once(data => {
              res(data)
            })
        }),
      // force retry on undefined in case the undefined was a false negative
      v => typeof v === 'undefined'
    )

    const alreadyContactedOnCurrHandshakeNode =
      typeof hrInHandshakeNode !== 'undefined'

    if (alreadyContactedOnCurrHandshakeNode) {
      throw new Error(ErrorCode.ALREADY_REQUESTED_HANDSHAKE)
    }
  }

  logger.info('sendHR() -> before __createOutgoingFeed')

  const outgoingFeedID = await __createOutgoingFeed(
    recipientPublicKey,
    user,
    SEA
  )

  logger.info('sendHR() -> before encryptedForUsOutgoingFeedID')

  const encryptedForUsOutgoingFeedID = await SEA.encrypt(
    outgoingFeedID,
    ourSecret
  )

  const timestamp = Date.now()

  /** @type {HandshakeRequest} */
  const handshakeRequestData = {
    from: user.is.pub,
    response: encryptedForUsOutgoingFeedID,
    timestamp
  }

  const encryptedForMeRecipientPublicKey = await SEA.encrypt(
    recipientPublicKey,
    mySecret
  )

  logger.info('sendHR() -> before newHandshakeRequestID')
  /** @type {string} */
  const newHandshakeRequestID = await new Promise((res, rej) => {
    const hr = gun
      .get(Key.HANDSHAKE_NODES)
      .get(currentHandshakeAddress)
      //@ts-ignore
      .set(handshakeRequestData, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(`Error trying to create request: ${ack.err}`))
        } else {
          res(hr._.get)
        }
      })
  })

  await new Promise((res, rej) => {
    user
      .get(Key.USER_TO_LAST_REQUEST_SENT)
      .get(recipientPublicKey)
      .put(newHandshakeRequestID, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })

  // This needs to come before the write to sent requests. Because that write
  // triggers Jobs.onAcceptedRequests and it in turn reads from request-to-user

  /**
   * @type {StoredReq}
   */
  const storedReq = {
    sentReqID: await SEA.encrypt(newHandshakeRequestID, mySecret),
    recipientPub: encryptedForMeRecipientPublicKey,
    handshakeAddress: await SEA.encrypt(currentHandshakeAddress, mySecret),
    timestamp
  }

  await new Promise((res, rej) => {
    //@ts-ignore
    user.get(Key.STORED_REQS).set(storedReq, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        rej(
          new Error(
            `Error saving newly created request to sent requests: ${ack.err}`
          )
        )
      } else {
        res()
      }
    })
  })
}

/**
 * Returns the message id.
 * @param {string} recipientPublicKey
 * @param {string} body
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {Promise<import('shock-common').Schema.ChatMessage>} The message id.
 */
const sendMessageNew = async (recipientPublicKey, body, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  if (typeof recipientPublicKey !== 'string') {
    throw new TypeError(
      `expected recipientPublicKey to be an string, but instead got: ${typeof recipientPublicKey}`
    )
  }

  if (recipientPublicKey.length === 0) {
    throw new TypeError(
      'expected recipientPublicKey to be an string of length greater than zero'
    )
  }

  if (typeof body !== 'string') {
    throw new TypeError(
      `expected message to be an string, instead got: ${typeof body}`
    )
  }

  if (body.length === 0) {
    throw new TypeError(
      'expected message to be an string of length greater than zero'
    )
  }

  const outgoingID = await Utils.recipientToOutgoingID(recipientPublicKey)

  if (outgoingID === null) {
    throw new Error(
      `Could not fetch an outgoing id for user: ${recipientPublicKey}`
    )
  }

  const recipientEpub = await Utils.pubToEpub(recipientPublicKey)
  const ourSecret = await SEA.secret(recipientEpub, user._.sea)
  if (typeof ourSecret !== 'string') {
    throw new TypeError("sendMessage() -> typeof ourSecret !== 'string'")
  }
  const encryptedBody = await SEA.encrypt(body, ourSecret)

  const newMessage = {
    body: encryptedBody,
    timestamp: Date.now()
  }

  return new Promise((res, rej) => {
    const msgNode = user
      .get(Key.OUTGOINGS)
      .get(outgoingID)
      .get(Key.MESSAGES)
      .set(newMessage, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res({
            body,
            id: msgNode._.get,
            outgoing: true,
            timestamp: newMessage.timestamp
          })
        }
      })
  })
}

/**
 * Returns the message id.
 * @param {string} recipientPublicKey
 * @param {string} body
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {Promise<string>} The message id.
 */
const sendMessage = async (recipientPublicKey, body, user, SEA) =>
  (await sendMessageNew(recipientPublicKey, body, user, SEA)).id

/**
 * @param {string} recipientPub
 * @param {string} msgID
 * @param {UserGUNNode} user
 * @returns {Promise<void>}
 */
const deleteMessage = async (recipientPub, msgID, user) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  if (typeof recipientPub !== 'string') {
    throw new TypeError(
      `expected recipientPublicKey to be an string, but instead got: ${typeof recipientPub}`
    )
  }

  if (recipientPub.length === 0) {
    throw new TypeError(
      'expected recipientPublicKey to be an string of length greater than zero'
    )
  }

  if (typeof msgID !== 'string') {
    throw new TypeError(
      `expected msgID to be an string, instead got: ${typeof msgID}`
    )
  }

  if (msgID.length === 0) {
    throw new TypeError(
      'expected msgID to be an string of length greater than zero'
    )
  }

  const outgoingID = await Utils.recipientToOutgoingID(recipientPub)

  if (outgoingID === null) {
    throw new Error(`Could not fetch an outgoing id for user: ${recipientPub}`)
  }

  return new Promise((res, rej) => {
    user
      .get(Key.OUTGOINGS)
      .get(outgoingID)
      .get(Key.MESSAGES)
      .get(msgID)
      .put(null, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })
}
/**
 * Returns the message id.
 * @param {string} botId
 * @param {string} body
 * @param {boolean} outgoing
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {Promise<import('shock-common').Schema.ChatMessage>} The message id.
 */
const writeBotMessage = async (botId, body, outgoing, user, SEA) => {
  if (!user.is) {
    throw new Error(ErrorCode.NOT_AUTH)
  }

  if (typeof botId !== 'string') {
    throw new TypeError(
      `expected botId to be an string, but instead got: ${typeof botId}`
    )
  }

  if (botId.length === 0) {
    throw new TypeError(
      'expected botId to be an string of length greater than zero'
    )
  }

  if (typeof body !== 'string') {
    throw new TypeError(
      `expected message to be an string, instead got: ${typeof body}`
    )
  }

  if (body.length === 0) {
    throw new TypeError(
      'expected message to be an string of length greater than zero'
    )
  }

  const mySecret = require('../Mediator').getMySecret()
  const encryptedBody = await SEA.encrypt(body, mySecret)

  const newMessage = {
    body: encryptedBody,
    timestamp: Date.now(),
    outgoing
  }
  return new Promise((res, rej) => {
    const msgNode = user
      .get(Key.CHAT_BOTS_CHATS)
      .get(botId)
      .get(Key.MESSAGES)
      .set(newMessage, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res({
            body,
            id: msgNode._.get,
            outgoing,
            timestamp: newMessage.timestamp
          })
        }
      })
  })
}

/**
 * @param {string|null} avatar
 * @param {UserGUNNode} user
 * @throws {TypeError} Rejects if avatar is not an string or an empty string.
 * @returns {Promise<void>}
 */
const setAvatar = (avatar, user) =>
  new Promise((resolve, reject) => {
    if (!user.is) {
      throw new Error(ErrorCode.NOT_AUTH)
    }

    if (typeof avatar === 'string' && avatar.length === 0) {
      throw new TypeError(
        "'avatar' must be an string and have length greater than one or be null"
      )
    }

    if (typeof avatar !== 'string' && avatar !== null) {
      throw new TypeError(
        "'avatar' must be an string and have length greater than one or be null"
      )
    }

    user
      .get(Key.PROFILE_BINARY)
      .get(Key.AVATAR)
      .put(avatar, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          reject(new Error(ack.err))
        } else {
          resolve()
        }
      })
  })

/**
 * @param {string} displayName
 * @param {UserGUNNode} user
 * @throws {TypeError} Rejects if displayName is not an string or an empty
 * string.
 * @returns {Promise<void>}
 */
const setDisplayName = (displayName, user) =>
  new Promise((resolve, reject) => {
    if (!user.is) {
      throw new Error(ErrorCode.NOT_AUTH)
    }

    if (typeof displayName !== 'string') {
      throw new TypeError()
    }

    if (displayName.length === 0) {
      throw new TypeError()
    }

    user
      .get(Key.PROFILE)
      .get(Key.DISPLAY_NAME)
      .put(displayName, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          reject(new Error(ack.err))
        } else {
          resolve()
        }
      })
  })

/**
 * @param {string} initialMsg
 * @param {string} recipientPublicKey
 * @param {GUNNode} gun
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @throws {Error|TypeError}
 * @returns {Promise<void>}
 */
const sendHRWithInitialMsg = async (
  initialMsg,
  recipientPublicKey,
  gun,
  user,
  SEA
) => {
  /** @type {boolean} */
  const alreadyHandshaked = await Utils.tryAndWait(
    (_, user) =>
      new Promise((res, rej) => {
        user
          .get(Key.USER_TO_INCOMING)
          .get(recipientPublicKey)
          .once(inc => {
            if (typeof inc !== 'string') {
              res(false)
            } else if (inc.length === 0) {
              rej(
                new Error(
                  `sendHRWithInitialMsg()-> obtained encryptedIncomingId from user-to-incoming an string but of length 0`
                )
              )
            } else {
              res(true)
            }
          })
      })
  )

  if (!alreadyHandshaked) {
    await sendHandshakeRequest(recipientPublicKey, gun, user, SEA)
  }

  await sendMessage(recipientPublicKey, initialMsg, user, SEA)
}

/**
 * @typedef {object} SpontPaymentOptions
 * @prop {Common.Schema.OrderTargetType} type
 * @prop {string=} postID
 */

/**
 * Returns the preimage corresponding to the payment.
 * @param {string} to
 * @param {number} amount
 * @param {string} memo
 * @param {number} feeLimit
 * @param {SpontPaymentOptions} opts
 * @throws {Error} If no response in less than 20 seconds from the recipient, or
 * lightning cannot find a route for the payment.
 * @returns {Promise<PaymentV2>} The payment's preimage.
 */
const sendSpontaneousPayment = async (
  to,
  amount,
  memo,
  feeLimit,
  opts = { type: 'user' }
) => {
  try {
    const SEA = require('../Mediator').mySEA
    const getUser = () => require('../Mediator').getUser()
    const recipientEpub = await Utils.pubToEpub(to)
    const ourSecret = await SEA.secret(recipientEpub, getUser()._.sea)

    if (amount < 1) {
      throw new RangeError('Amount must be at least 1 sat.')
    }

    const currOrderAddress = await Getters.currentOrderAddress(to)

    logger.info('sendPayment() -> will now create order:')

    /** @type {Order} */
    const order = {
      amount: amount.toString(),
      from: getUser()._.sea.pub,
      memo: memo || 'no memo',
      timestamp: Date.now(),
      targetType: opts.type
    }

    if (opts.type === 'post') {
      order.postID = opts.postID
    }

    logger.info(JSON.stringify(order))

    /* eslint-disable require-atomic-updates */
    const [encMemo, encAmount] = await Promise.all([
      SEA.encrypt(order.memo, ourSecret),
      SEA.encrypt(order.amount, ourSecret)
    ])

    order.memo = encMemo
    order.amount = encAmount
    order.timestamp = Date.now() // most up to date timestamp
    logger.info(`sendPayment() -> encrypted order: ${JSON.stringify(order)}`)

    /* eslint-enable require-atomic-updates */

    logger.info(
      `sendPayment() -> will now place order into address: ${currOrderAddress} for PK: ${to}`
    )

    /** @type {string} */
    const orderID = await new Promise((res, rej) => {
      const ord = require('../Mediator')
        .getGun()
        .get(Key.ORDER_NODES)
        .get(currOrderAddress)
        //@ts-ignore
        .set(order, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(
              new Error(
                `Error writing order to order node: ${currOrderAddress} for pub: ${to}: ${ack.err}`
              )
            )
          } else {
            res(ord._.get)
          }
        })
    })

    if (typeof orderID !== 'string') {
      const msg = `orderID returned by gun not an string, got: ${JSON.stringify(
        orderID
      )}`
      throw new Error(msg)
    }

    /** @type {import('shock-common').Schema.OrderResponse} */
    const encryptedOrderRes = await Utils.tryAndWait(
      gun =>
        new Promise(res => {
          gun
            .user(to)
            .get(Key.ORDER_TO_RESPONSE)
            .get(orderID)
            .on(orderResponse => {
              if (Schema.isOrderResponse(orderResponse)) {
                res(orderResponse)
              }
            })
        }),
      v => !Schema.isOrderResponse(v)
    )

    if (!Schema.isOrderResponse(encryptedOrderRes)) {
      const e = TypeError(
        `Expected OrderResponse got: ${typeof encryptedOrderRes}`
      )
      logger.error(e)
      throw e
    }

    /** @type {import('shock-common').Schema.OrderResponse} */
    const orderResponse = {
      response: await SEA.decrypt(encryptedOrderRes.response, ourSecret),
      type: encryptedOrderRes.type
    }

    logger.info('decoded orderResponse: ' + JSON.stringify(orderResponse))

    if (orderResponse.type === 'err') {
      throw new Error(orderResponse.response)
    }

    logger.info('Will now check for invoice amount mismatch')

    const encodedInvoice = orderResponse.response

    const { num_satoshis: decodedAmt } = await decodePayReq(encodedInvoice)

    if (decodedAmt !== amount.toString()) {
      throw new Error('Invoice amount mismatch')
    }

    // double check
    if (Number(decodedAmt) !== amount) {
      throw new Error('Invoice amount mismatch')
    }

    logger.info('Will now send payment through lightning')

    const payment = await sendPaymentV2Invoice({
      feeLimit,
      payment_request: orderResponse.response
    })

    return payment
  } catch (e) {
    logger.error('Error inside sendPayment()')
    logger.error(e)
    throw e
  }
}

/**
 * Returns the preimage corresponding to the payment.
 * @param {string} to
 * @param {number} amount
 * @param {string} memo
 * @param {number} feeLimit
 * @throws {Error} If no response in less than 20 seconds from the recipient, or
 * lightning cannot find a route for the payment.
 * @returns {Promise<string>} The payment's preimage.
 */
const sendPayment = async (to, amount, memo, feeLimit) => {
  const payment = await sendSpontaneousPayment(to, amount, memo, feeLimit)
  return payment.payment_preimage
}

/**
 * @param {UserGUNNode} user
 * @returns {Promise<void>}
 */
const generateOrderAddress = user =>
  new Promise((res, rej) => {
    if (!user.is) {
      throw new Error(ErrorCode.NOT_AUTH)
    }

    const address = uuidv1()

    user.get(Key.CURRENT_ORDER_ADDRESS).put(address, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        rej(new Error(ack.err))
      } else {
        res()
      }
    })
  })

/**
 * @param {string|null} bio
 * @param {UserGUNNode} user
 * @throws {TypeError} Rejects if avatar is not an string or an empty string.
 * @returns {Promise<void>}
 */
const setBio = (bio, user) =>
  new Promise((resolve, reject) => {
    if (!user.is) {
      throw new Error(ErrorCode.NOT_AUTH)
    }

    if (typeof bio === 'string' && bio.length === 0) {
      throw new TypeError(
        "'bio' must be an string and have length greater than one or be null"
      )
    }

    if (typeof bio !== 'string' && bio !== null) {
      throw new TypeError(
        "'bio' must be an string and have length greater than one or be null"
      )
    }

    user.get(Key.BIO).put(bio, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        reject(new Error(ack.err))
      } else {
        resolve()
      }
    })
  }).then(
    () =>
      new Promise((resolve, reject) => {
        user
          .get(Key.PROFILE)
          .get(Key.BIO)
          .put(bio, ack => {
            if (ack.err && typeof ack.err !== 'number') {
              reject(new Error(ack.err))
            } else {
              resolve()
            }
          })
      })
  )

/**
 * @param {string[]} mnemonicPhrase
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {Promise<void>}
 */
const saveSeedBackup = async (mnemonicPhrase, user, SEA) => {
  if (
    !Array.isArray(mnemonicPhrase) ||
    mnemonicPhrase.some(word => typeof word !== 'string') ||
    mnemonicPhrase.length === 0
  ) {
    throw new TypeError('expected mnemonicPhrase to be an string array')
  }

  const mySecret = require('../Mediator').getMySecret()
  const encryptedSeed = await SEA.encrypt(mnemonicPhrase.join(' '), mySecret)

  return new Promise((res, rej) => {
    user.get(Key.SEED_BACKUP).put(encryptedSeed, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        rej(new Error(ack.err))
      } else {
        res()
      }
    })
  })
}

/**
 * @param {string} backups
 * @param {UserGUNNode} user
 * @param {ISEA} SEA
 * @returns {Promise<void>}
 */
const saveChannelsBackup = async (backups, user, SEA) => {
  if (backups === '') {
    throw new TypeError('cant save an empty channel backup')
  }
  const mySecret = require('../Mediator').getMySecret()
  const encryptBackups = await SEA.encrypt(backups, mySecret)
  return new Promise((res, rej) => {
    user.get(Key.CHANNELS_BACKUP).put(encryptBackups, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        rej(new Error(ack.err))
      } else {
        res()
      }
    })
  })
}

/**
 * @param {string} pub
 * @returns {Promise<void>}
 */
const disconnect = async pub => {
  if (!(await Utils.successfulHandshakeAlreadyExists(pub))) {
    throw new Error('No handshake exists for this pub')
  }

  await Promise.all([cleanup(pub), generateHandshakeAddress()])
}

/**
 * @returns {Promise<void>}
 */
const setLastSeenApp = () =>
  new Promise((res, rej) => {
    require('../Mediator')
      .getUser()
      .get(Key.LAST_SEEN_APP)
      .put(Date.now(), ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  }).then(
    () =>
      new Promise((res, rej) => {
        require('../Mediator')
          .getUser()
          .get(Key.PROFILE)
          .get(Key.LAST_SEEN_APP)
          .put(Date.now(), ack => {
            if (ack.err && typeof ack.err !== 'number') {
              rej(new Error(ack.err))
            } else {
              res()
            }
          })
      })
  )

/**
 * @param {string[]} tags
 * @param {string} title
 * @param {Common.Schema.ContentItem[]} content
 * @returns {Promise<[string, Common.Schema.RawPost]>}
 */
const createPostNew = async (tags, title, content) => {
  /** @type {Common.Schema.RawPost} */
  const newPost = {
    date: Date.now(),
    status: 'publish',
    tags: tags.join('-'),
    title,
    contentItems: {},
    tipCounter: 0
  }

  content.forEach(c => {
    // @ts-expect-error
    const uuid = Gun.text.random()
    newPost.contentItems[uuid] = c
  })

  /** @type {string} */
  const postID = await Common.makePromise((res, rej) => {
    const _n = require('../Mediator')
      .getUser()
      .get(Key.POSTS_NEW)
      .set(
        // @ts-expect-error
        newPost,
        ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res(_n._.get)
          }
        }
      )
  })

  return [postID, newPost]
}

/**
 * @param {string[]} tags
 * @param {string} title
 * @param {Common.Schema.ContentItem[]} content
 * @returns {Promise<Common.Schema.Post>}
 */
const createPost = async (tags, title, content) => {
  if (content.length === 0) {
    throw new Error(`A post must contain at least one paragraph/image/video`)
  }

  const numOfPages = await (async () => {
    const maybeNumOfPages = await Utils.tryAndWait(
      (_, user) =>
        user
          .get(Key.WALL)
          .get(Key.NUM_OF_PAGES)
          .then(),
      v => typeof v !== 'number'
    )

    if (typeof maybeNumOfPages !== 'number') {
      throw new TypeError(
        `Could not fetch number of pages from wall, instead got: ${JSON.stringify(
          maybeNumOfPages
        )}`
      )
    }

    return maybeNumOfPages
  })()

  let pageIdx = Math.max(0, numOfPages - 1).toString()

  const count = await (async () => {
    if (numOfPages === 0) {
      return 0
    }

    const maybeCount = await Utils.tryAndWait(
      (_, user) =>
        user
          .get(Key.WALL)
          .get(Key.PAGES)
          .get(pageIdx)
          .get(Key.COUNT)
          .then(),
      v => typeof v !== 'number'
    )

    return typeof maybeCount === 'number' ? maybeCount : 0
  })()

  const shouldBeNewPage =
    count >= Common.Constants.Misc.NUM_OF_POSTS_PER_WALL_PAGE

  if (shouldBeNewPage) {
    pageIdx = Number(pageIdx + 1).toString()
  }

  await new Promise((res, rej) => {
    require('../Mediator')
      .getUser()
      .get(Key.WALL)
      .get(Key.PAGES)
      .get(pageIdx)
      .put(
        {
          [Key.COUNT]: shouldBeNewPage ? 1 : count + 1,
          posts: {
            unused: null
          }
        },
        ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          }

          res()
        }
      )
  })

  const [postID, newPost] = await createPostNew(tags, title, content)

  await Common.makePromise((res, rej) => {
    require('../Mediator')
      .getUser()
      .get(Key.WALL)
      .get(Key.PAGES)
      .get(pageIdx)
      .get(Key.POSTS)
      .get(postID)
      .put(
        // @ts-expect-error
        newPost,
        ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        }
      )
  })

  if (shouldBeNewPage || numOfPages === 0) {
    await new Promise(res => {
      require('../Mediator')
        .getUser()
        .get(Key.WALL)
        .get(Key.NUM_OF_PAGES)
        .put(numOfPages + 1, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            throw new Error(ack.err)
          }

          res()
        })
    })
  }

  const loadedPost = await new Promise(res => {
    require('../Mediator')
      .getUser()
      .get(Key.WALL)
      .get(Key.PAGES)
      .get(pageIdx)
      .get(Key.POSTS)
      .get(postID)
      .load(data => {
        res(data)
      })
  })

  /** @type {Common.Schema.User} */
  const userForPost = await Getters.getMyUser()

  /** @type {Common.Schema.Post} */
  const completePost = {
    ...loadedPost,
    author: userForPost,
    id: postID
  }

  if (!Common.Schema.isPost(completePost)) {
    throw new Error(
      `completePost not a Post inside Actions.createPost(): ${JSON.stringify(
        completePost
      )}`
    )
  }

  return completePost
}

/**
 * @param {string} postId
 * @param {string} page
 * @returns {Promise<void>}
 */
const deletePost = async (postId, page) => {
  await new Promise((res, rej) => {
    require('../Mediator')
      .getUser()
      .get(Key.WALL)
      .get(Key.PAGES)
      .get(page)
      .get(Key.POSTS)
      .get(postId)
      .put(null, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })
}

/**
 * @param {string} publicKey
 * @param {boolean} isPrivate Will overwrite previous private status.
 * @returns {Promise<string>}
 */
const follow = (publicKey, isPrivate) => {
  /** @type {import('shock-common').Schema.Follow} */
  const newFollow = {
    private: isPrivate,
    status: 'ok',
    user: publicKey
  }

  return new Promise((res, rej) => {
    require('../Mediator')
      .getUser()
      .get(Key.FOLLOWS)
      .get(publicKey)
      // @ts-ignore
      .put(newFollow, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })
}

/**
 * @param {string} publicKey
 * @returns {Promise<void>}
 */
const unfollow = publicKey =>
  new Promise((res, rej) => {
    require('../Mediator')
      .getUser()
      .get(Key.FOLLOWS)
      .get(publicKey)
      .put(null, ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
  })

/**
 * @throws {Error}
 * @returns {Promise<void>}
 */
const initWall = async () => {
  const user = require('../Mediator').getUser()

  const promises = []

  promises.push(
    new Promise((res, rej) => {
      user
        .get(Key.WALL)
        .get(Key.NUM_OF_PAGES)
        .put(0, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        })
    })
  )

  promises.push(
    new Promise((res, rej) => {
      user
        .get(Key.WALL)
        .get(Key.PAGES)
        .get('0')
        .get(Key.POSTS)
        .put(
          {
            unused: null
          },
          ack => {
            if (ack.err && typeof ack.err !== 'number') {
              rej(new Error(ack.err))
            } else {
              res()
            }
          }
        )
    })
  )

  promises.push(
    new Promise((res, rej) => {
      user
        .get(Key.WALL)
        .get(Key.PAGES)
        .get('0')
        .get(Key.COUNT)
        .put(0, ack => {
          if (ack.err && typeof ack.err !== 'number') {
            rej(new Error(ack.err))
          } else {
            res()
          }
        })
    })
  )

  await Promise.all(promises)
}

module.exports = {
  __createOutgoingFeed,
  acceptRequest,
  authenticate,
  blacklist,
  generateHandshakeAddress,
  sendHandshakeRequest,
  deleteMessage,
  sendMessage,
  sendHRWithInitialMsg,
  setAvatar,
  setDisplayName,
  sendPayment,
  generateOrderAddress,
  setBio,
  saveSeedBackup,
  saveChannelsBackup,
  disconnect,
  setLastSeenApp,
  createPost,
  deletePost,
  follow,
  unfollow,
  initWall,
  sendMessageNew,
  sendSpontaneousPayment,
  createPostNew,
  writeBotMessage
}
