'use strict'

const Spiegel = require('../../src/spiegel')
const testUtils = require('../utils')
const Slouch = require('couch-slouch')
const sporks = require('sporks')

describe('spiegel', () => {
  let spiegel = null

  beforeEach(async () => {
    // test1_ is already taken by testUtils
    spiegel = new Spiegel(null, { dbName: 'test2_spiegel', namespace: 'test2_' })
    await spiegel.install()
  })

  afterEach(async () => {
    await spiegel.uninstall()
  })

  it('must have _admin to access', async () => {
    let slouch = new Slouch(testUtils.couchDBURLWithoutAuth())
    await sporks.shouldThrow(
      () => {
        return slouch.db.get('test2_spiegel')
      },
      { name: 'NotAuthorizedError' }
    )
  })
})
