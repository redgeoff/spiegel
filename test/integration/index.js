'use strict'

const Server = require('./api-server')
const Spawner = require('./spawner')
const testUtils = require('../utils')
const config = require('../../src/config.json')

// A basic sanity test at the topmost layer to make sure that things are working
describe('integration', function () {
  let server = null
  let spawner = null
  let suffix = null
  let docs1 = null
  let docs2 = null

  // More time is needed for these tests
  const TIMEOUT = 60000
  this.timeout(TIMEOUT)

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
    let waitForChangeListening = testUtils
      .waitFor(
        async () => {
          docs1 = await spawner._spiegel._slouch.doc.allArray('test_db1' + suffix, {
            include_docs: true
          })

          docs2 = await spawner._spiegel._slouch.doc.allArray('test_db2' + suffix, {
            include_docs: true
          })

          return JSON.stringify(docs1) === JSON.stringify(docs2) ? true : undefined
        },
        TIMEOUT - 2000,
        1000
      )
      .catch(err => {
        console.error('test_db2' + suffix + '=' + JSON.stringify(docs2))
        throw err
      })

    let waitForReplication = testUtils
      .waitFor(() => {
        return server.numRequests > 0 ? true : undefined
      }, TIMEOUT - 2000)
      .catch(err => {
        console.error('server.numRequests=', server.numRequests)
        throw err
      })

    await Promise.all([waitForChangeListening, waitForReplication])
  })
})
