/** @format */
const ECCrypto = require('eccrypto')
const Storage = require('node-persist')
const logger = require('winston')
const FieldError = require('../fieldError')
const {
  convertBufferToBase64,
  processKey,
  convertToEncryptedMessageResponse,
  convertUTF8ToBuffer,
  convertToEncryptedMessage,
  convertBase64ToBuffer
} = require('./crypto')

const nodeKeyPairs = new Map()
const devicePublicKeys = new Map()

/**
 * @typedef {object} EncryptedMessage
 * @prop {string} ciphertext
 * @prop {string} iv
 * @prop {string} mac
 * @prop {string} ephemPublicKey
 */

/**
 * Checks if the message supplied is encrypted or not
 * @param {EncryptedMessage} message
 */
const isEncryptedMessage = message =>
  message &&
  message.ciphertext &&
  message.iv &&
  message.mac &&
  message.ephemPublicKey

/**
 * Generates a new encryption key pair that will be used
 * when communicating with the deviceId specified
 * @param {string} deviceId
 */
const generateKeyPair = deviceId => {
  try {
    const privateKey = ECCrypto.generatePrivate()
    const publicKey = ECCrypto.getPublic(privateKey)
    const privateKeyBase64 = convertBufferToBase64(privateKey)
    const publicKeyBase64 = convertBufferToBase64(publicKey)

    if (!Buffer.isBuffer(privateKey) || !Buffer.isBuffer(publicKey)) {
      throw new Error('Invalid KeyPair Generated')
    }

    nodeKeyPairs.set(deviceId, {
      privateKey,
      publicKey
    })

    return {
      privateKey,
      publicKey,
      privateKeyBase64,
      publicKeyBase64
    }
  } catch (err) {
    logger.error(
      '[ENCRYPTION] An error has occurred while generating a new KeyPair',
      err
    )
    logger.error('Device ID:', deviceId)

    throw err
  }
}

/**
 * Checks if the specified device has a keypair generated
 * @param {{ deviceId: string }} arg0
 */
const isAuthorizedDevice = ({ deviceId }) => devicePublicKeys.has(deviceId)

/**
 * Generates a new keypair for the deviceId specified and
 * saves its publicKey locally
 * @param {{ deviceId: string, publicKey: string }} arg0
 */
const authorizeDevice = async ({ deviceId, publicKey }) => {
  const hostId = await Storage.get('encryption/hostId')
  devicePublicKeys.set(deviceId, convertBase64ToBuffer(publicKey))
  const keyPair = generateKeyPair(deviceId)

  return {
    success: true,
    APIPublicKey: keyPair.publicKeyBase64,
    hostId
  }
}

/**
 * Encrypts the specified message using the specified deviceId's
 * public key
 * @param {{ deviceId: string, message: string | number | boolean }} arg0
 * @returns {Promise<import('./crypto').EncryptedMessageResponse>}
 */
const encryptMessage = async ({ message = '', deviceId }) => {
  const parsedMessage = message.toString()
  const publicKey = devicePublicKeys.get(deviceId)

  if (!publicKey) {
    throw new FieldError({
      field: 'deviceId',
      message: 'Unauthorized Device ID detected'
    })
  }

  const processedPublicKey = processKey(publicKey)
  const messageBuffer = convertUTF8ToBuffer(parsedMessage)
  const encryptedMessage = await ECCrypto.encrypt(
    processedPublicKey,
    messageBuffer
  )
  const encryptedMessageResponse = {
    ciphertext: encryptedMessage.ciphertext,
    iv: encryptedMessage.iv,
    mac: encryptedMessage.mac,
    ephemPublicKey: encryptedMessage.ephemPublicKey
  }

  return convertToEncryptedMessageResponse(encryptedMessageResponse)
}

/**
 * Decrypts the specified message using the API keypair
 * associated with the specified deviceId
 * @param {{ encryptedMessage: EncryptedMessage, deviceId: string }} arg0
 */
const decryptMessage = async ({ encryptedMessage, deviceId }) => {
  const keyPair = nodeKeyPairs.get(deviceId)
  try {
    if (!keyPair) {
      throw new FieldError({
        field: 'deviceId',
        message: 'Unauthorized Device ID detected'
      })
    }

    const processedPrivateKey = processKey(keyPair.privateKey)
    const decryptedMessage = await ECCrypto.decrypt(
      processedPrivateKey,
      convertToEncryptedMessage(encryptedMessage)
    )
    const parsedMessage = decryptedMessage.toString('utf8')
    return parsedMessage
  } catch (err) {
    if (err.message?.toLowerCase() === 'bad mac') {
      console.error(
        'Bad Mac!',
        err,
        convertToEncryptedMessage(encryptedMessage),
        !!keyPair
      )
    }

    throw err
  }
}

module.exports = {
  isAuthorizedDevice,
  isEncryptedMessage,
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  authorizeDevice
}
