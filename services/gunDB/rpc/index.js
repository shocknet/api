/**
 * @format
 */
/* eslint-disable no-use-before-define */
// @ts-check
const { makePromise, Constants, Schema } = require('shock-common')
const mapValues = require('lodash/mapValues')
const Bluebird = require('bluebird')
const Gun = require('gun')

const { pubToEpub } = require('../contact-api/utils')
const {
  getGun,
  getUser,
  mySEA: SEA,
  getMySecret,
  $$__SHOCKWALLET__ENCRYPTED__
} = require('../Mediator')
/**
 * @typedef {import('../contact-api/SimpleGUN').ValidDataValue} ValidDataValue
 * @typedef {import('./types').ValidRPCDataValue} ValidRPCDataValue
 * @typedef {import('./types').RPCData} RPCData
 */

const PATH_SEPARATOR = '>'

/**
 * @param {ValidDataValue} value
 * @param {string} publicKey
 * @returns {Promise<ValidDataValue>}
 */
const deepDecryptIfNeeded = async (value, publicKey) => {
  if (Schema.isObj(value)) {
    return Bluebird.props(
      mapValues(value, o => deepDecryptIfNeeded(o, publicKey))
    )
  }

  if (
    typeof value === 'string' &&
    value.indexOf($$__SHOCKWALLET__ENCRYPTED__) === 0
  ) {
    const user = getUser()
    if (!user.is) {
      throw new Error(Constants.ErrorCode.NOT_AUTH)
    }

    let sec = ''
    if (user.is.pub === publicKey || 'me' === publicKey) {
      sec = getMySecret()
    } else {
      sec = await SEA.secret(await pubToEpub(publicKey), user._.sea)
    }

    const decrypted = SEA.decrypt(value, sec)

    return decrypted
  }

  return value
}

/**
 * @param {ValidRPCDataValue} value
 * @returns {Promise<ValidRPCDataValue>}
 */
// eslint-disable-next-line func-style
async function deepEncryptIfNeeded(value) {
  const u = getUser()

  if (!u.is) {
    throw new Error(Constants.ErrorCode.NOT_AUTH)
  }

  if (!Schema.isObj(value)) {
    return value
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map(v => deepEncryptIfNeeded(v)))
  }

  const pk = /** @type {string|undefined} */ (value.$$__ENCRYPT__FOR)

  if (!pk) {
    return Bluebird.props(mapValues(value, deepEncryptIfNeeded))
  }

  const actualValue = /** @type {string} */ (value.value)

  let encryptedValue = ''

  if (pk === u.is.pub || pk === 'me') {
    encryptedValue = await SEA.encrypt(actualValue, getMySecret())
  } else {
    const sec = await SEA.secret(await pubToEpub(pk), u._.sea)

    encryptedValue = await SEA.encrypt(actualValue, sec)
  }

  return encryptedValue
}

/**
 * @param {string} rawPath
 * @param {ValidRPCDataValue} value
 * @returns {Promise<void>}
 */
const put = async (rawPath, value) => {
  const [root, ...path] = rawPath.split(PATH_SEPARATOR)

  const node = (() => {
    // eslint-disable-next-line init-declarations
    let _node

    if (root === '$gun') {
      _node = getGun()
    } else if (root === '$user') {
      const u = getUser()

      if (!u.is) {
        throw new Error(Constants.ErrorCode.NOT_AUTH)
      }

      _node = u
    } else {
      throw new TypeError(
        `Unknown kind of root, expected $gun or $user but got: ${root}`
      )
    }

    for (const bit of path) {
      _node = _node.get(bit)
    }

    return _node
  })()

  const theValue = await deepEncryptIfNeeded(value)

  if (Array.isArray(theValue)) {
    await Promise.all(theValue.map(v => set(rawPath, v)))

    // Do not remove this return, an array is also an object
    // eslint-disable-next-line no-useless-return
    return
  } else if (Schema.isObj(theValue)) {
    const currValue = await node.then()

    if (Schema.isObj(currValue)) {
      const writes = mapValues(theValue, (v, k) =>
        put(rawPath + PATH_SEPARATOR + k, v)
      )

      await Bluebird.props(writes)
    } else {
      // if the value at path foo is null or another primitive, then
      // foo.get('bar').put(baz) will NOT work, the write needs to happen like so:
      // foo.put({ bar: baz }). Doing foo.put({}) also works but it won't replace
      // the primitive value with an empty object but with the last object
      // representation of that node. Doing foo.put({ anything: whatever }) will
      // merge that new object with the previous representation too. Both of which
      // can result in inconsistent states so please thread carefully. What I
      // chose to do here was put without waiting for ack, and if the actual
      // user-generated puts fail, roll back to the previous local state in order
      // to accomplish some kind of atomicity. This bug will mostly affect maps
      // instead of sets as deleted keys in a set should not be reused.
      // Maps should conform to an schema to avoid inconsistent data.
      try {
        node.put({}) // changes from current primitive value to last known object value

        const writes = mapValues(theValue, (v, k) =>
          put(rawPath + PATH_SEPARATOR + k, v)
        )

        await Bluebird.props(writes)
      } catch (e) {
        if (typeof currValue !== 'undefined') {
          // if write was somehow unsuccessful, revert to last known primitive value
          node.put(currValue)
        }

        throw e
      }
    }
  } /* is primitive */ else {
    await makePromise((res, rej) => {
      node.put(/** @type {ValidDataValue} */ (theValue), ack => {
        if (ack.err && typeof ack.err !== 'number') {
          rej(new Error(ack.err))
        } else {
          res()
        }
      })
    })
  }
}

/**
 * @param {string} rawPath
 * @param {ValidRPCDataValue} value
 * @returns {Promise<string>}
 */
// eslint-disable-next-line func-style
async function set(rawPath, value) {
  const [root, ...path] = rawPath.split(PATH_SEPARATOR)

  const node = (() => {
    // eslint-disable-next-line init-declarations
    let _node

    if (root === '$gun') {
      _node = getGun()
    } else if (root === '$user') {
      const u = getUser()

      if (!u.is) {
        throw new Error(Constants.ErrorCode.NOT_AUTH)
      }

      _node = u
    } else {
      throw new TypeError(
        `Unknown kind of root, expected $gun or $user but got: ${root}`
      )
    }

    for (const bit of path) {
      _node = _node.get(bit)
    }

    return _node
  })()

  const theValue = await deepEncryptIfNeeded(value)

  if (Array.isArray(theValue)) {
    // we'll create a set of sets

    // @ts-expect-error
    const uuid = Gun.text.random()

    // here we are simulating the top-most set()
    const subPath = rawPath + PATH_SEPARATOR + uuid

    const writes = theValue.map(v => set(subPath, v))

    await Promise.all(writes)

    return uuid
  } else if (Schema.isObj(theValue)) {
    // @ts-expect-error
    const uuid = Gun.text.random() // we'll handle UUID ourselves

    // so we can use our own put()

    const subPath = rawPath + PATH_SEPARATOR + uuid

    await put(subPath, theValue)

    return uuid
  }

  /* else is primitive */

  const id = await makePromise((res, rej) => {
    const subNode = node.set(theValue, ack => {
      if (ack.err && typeof ack.err !== 'number') {
        rej(new Error(ack.err))
      } else {
        res(subNode._.get)
      }
    })
  })

  return id
}

module.exports = {
  put,
  set,
  deepDecryptIfNeeded,
  deepEncryptIfNeeded
}
