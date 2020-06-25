/**
 * @format
 */
const Common = require('shock-common')
const Utils = require('../utils')
const Key = require('../key')

/**
 * @returns {Promise<number>}
 */
const getWallTotalPages = async () => {
  const totalPages = await Utils.tryAndWait(
    (_, user) =>
      user
        .get(Key.WALL)
        .get(Key.NUM_OF_PAGES)
        .then(),
    v => typeof v !== 'number'
  )

  return typeof totalPages === 'number' ? totalPages : 0
}

/**
 * @param {number} page
 * @returns {Promise<Common.SchemaTypes.WallPage>}
 */
const getWallPage = async page => {
  const totalPages = await getWallTotalPages()

  if (page === 0 || totalPages === 0) {
    return {
      count: 0,
      posts: {}
    }
  }

  const actualPageIdx = page < 0 ? totalPages + (page + 1) : page - 1

  /**
   * @type {Common.SchemaTypes.WallPage}
   */
  const thePage = await Utils.tryAndWait(
    (_, user) =>
      new Promise(res => {
        user
          .get(Key.WALL)
          .get(Key.PAGES)
          .get(actualPageIdx.toString())
          // @ts-ignore
          .load(res)
      }),
    v => typeof v !== 'object'
  )

  const clean = {
    ...thePage
  }

  // delete unsuccessful writes
  Object.keys(clean.posts).forEach(k => {
    if (clean.posts[k] === null) {
      delete clean.posts[k]
    }
  })

  if (!Common.Schema.isWallPage(clean)) {
    throw new Error(
      `Fetched page not a wall page, instead got: ${JSON.stringify(clean)}`
    )
  }

  return clean
}

module.exports = {
  getWallTotalPages,
  getWallPage
}