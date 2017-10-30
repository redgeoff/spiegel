'use strict'

const Server = require('./api-server')
const Spawner = require('./spawner')
const sporks = require('sporks')
const testUtils = require('../utils')
const config = require('../../src/config.json')

// A basic sanity test at the topmost layer to make sure that things are working
describe('integration', () => {
  let server = null
  let spawner = null
  let suffix = null

  const createTestDBs = async () => {
    // Create DB and docs
    await testUtils.createTestDB('test_db1' + suffix)

    // Create just the DB
    await testUtils.createDB('test_db2' + suffix)
  }

  const createReplicator = async () => {
    // URL w/o the password
    let url =
      config.couchdb.scheme +
      '://' +
      config.couchdb.username +
      '@' +
      config.couchdb.host +
      ':' +
      config.couchdb.port

    await spawner._spiegel._slouch.doc.create(spawner._spiegel._dbName, {
      type: 'replicator',
      source: url + '/test_db1' + suffix,
      target: url + '/test_db2' + suffix
    })
  }

  const createOnChange = async () => {
    await spawner._spiegel._slouch.doc.create(spawner._spiegel._dbName, {
      type: 'on_change',
      db_name: 'test_db1' + suffix,
      url: 'http://user@localhost:3000/foo'
    })
  }

  beforeEach(async () => {
    suffix = testUtils.nextSuffix()

    server = new Server()
    await server.start()

    spawner = new Spawner()
    await spawner.start()

    await createReplicator()

    await createOnChange()

    await createTestDBs()
  })

  afterEach(async () => {
    await spawner.stop()

    await server.stop()

    await testUtils.destroyTestDBs()
  })

  it('should replicate and listen to changes', async () => {
    // TODO: use testUtils.waitFor instead of timeout
    await sporks.timeout(18000)

    // Make sure the docs were replicated
    let docs1 = await spawner._spiegel._slouch.doc.allArray('test_db1' + suffix, {
      include_docs: true
    })
    let docs2 = await spawner._spiegel._slouch.doc.allArray('test_db2' + suffix, {
      include_docs: true
    })
    docs2.should.eql(docs1)

    // Make sure the API was called during the change listening. Depending on the timing, it
    // possible to receive multiple requests.
    testUtils.shouldEqual(server.numRequests > 0, true)
  })
})
