/**
 * @format
 */
const Common = require('shock-common')
const isFinite = require('lodash/isFinite')
const shuffle = require('lodash/shuffle')
const R = require('ramda')

const Follows = require('./follows')
const Wall = require('./wall')

/**
 * @param {number} page
 * @throws {TypeError}
 * @throws {RangeError}
 * @returns {Promise<Common.SchemaTypes.Post[]>}
 */
const getFeedPage = async page => {
  if (!isFinite(page)) {
    throw new TypeError(`Please provide an actual number for [page]`)
  }

  if (page <= 0) {
    throw new RangeError(`Please provide only positive numbers for [page]`)
  }

  const subbedPublicKeys = Object.values(await Follows.currentFollows()).map(
    f => f.user
  )

  if (subbedPublicKeys.length === 0) {
    return []
  }

  // say there are 20 public keys total
  // page 1: page 1 from first 10 public keys
  // page 2: page 1 from second 10 public keys
  // page 3: page 2 from first 10 public keys
  // page 4: page 2 from first 10 public keys
  // etc

  const pagedPublicKeys = R.splitEvery(10, shuffle(subbedPublicKeys))

  if (pagedPublicKeys.length === 1) {
    const [publicKeys] = pagedPublicKeys

    const fetchedPages = await Promise.all(
      publicKeys.map(pk => Wall.getWallPage(page, pk))
    )

    const allPosts = fetchedPages.map(fp => Object.values(fp.posts))
    const posts = R.flatten(allPosts)
    // @ts-ignore
    const sorted = R.sortBy((a, b) => b.date - a.date, posts)

    return sorted
  }

  return []
}

module.exports = {
  getFeedPage
}