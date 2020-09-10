/**
 * @format
 */

const logger = require('winston')

const {
  Constants: {
    ErrorCode,
    Misc: { LAST_SEEN_NODE_INTERVAL }
  }
} = require('shock-common')
const Key = require('../key')
const { getUTCTimestamp } = require('../../../../utils/helpers')

/**
 * @typedef {import('../SimpleGUN').GUNNode} GUNNode
 * @typedef {import('../SimpleGUN').ListenerData} ListenerData
 * @typedef {import('../SimpleGUN').ISEA} ISEA
 * @typedef {import('../SimpleGUN').UserGUNNode} UserGUNNode
 */

/**
 * @param {UserGUNNode} user
 * @throws {Error} NOT_AUTH
 * @returns {void}
 */
const lastSeenNode = user => {
  if (!user.is) {
    logger.warn('onOrders() -> tried to sub without authing')
    throw new Error(ErrorCode.NOT_AUTH)
  }

  setInterval(() => {
    if (user.is) {
      user.get(Key.LAST_SEEN_NODE).put(getUTCTimestamp(), ack => {
        if (ack.err && typeof ack.err !== 'number') {
          logger.error(`Error inside lastSeenNode job: ${ack.err}`)
        }
      })

      user
        .get(Key.PROFILE)
        .get(Key.LAST_SEEN_NODE)
        .put(getUTCTimestamp(), ack => {
          if (ack.err && typeof ack.err !== 'number') {
            logger.error(`Error inside lastSeenNode job: ${ack.err}`)
          }
        })
    }
  }, LAST_SEEN_NODE_INTERVAL)
}

module.exports = lastSeenNode
