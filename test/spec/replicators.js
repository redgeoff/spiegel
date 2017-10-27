'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')

describe('replicators', () => {
  let replicators = null
  let replicatorIds = null
  let globalError = false
  let retryAfterSeconds = 1
  let stalledAfterSeconds = 1

  let conflictError = new Error()
  conflictError.error = 'conflict'

  const listenForErrors = () => {
    replicators.once('err', function (err) {
      globalError = err
    })
  }

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel, { retryAfterSeconds, stalledAfterSeconds })
    replicatorIds = []
    listenForErrors()
  })

  afterEach(async () => {
    await Promise.all(
      replicatorIds.map(async id => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, id)
      })
    )

    // Was there an error?
    if (globalError) {
      throw globalError
    }
  })

  it('should extract db name', function () {
    replicators._toDBName('http://example.com:5984/mydb').should.eql('mydb')

    // We don't really care about this case as we require the source to be a FQDN
    testUtils.shouldEqual(replicators._toDBName('mydb'), undefined)

    testUtils.shouldEqual(replicators._toDBName(''), undefined)

    testUtils.shouldEqual(replicators._toDBName(), undefined)
  })

  it('should convert to CouchDB replication params', async () => {
    // Sanity test some params
    let params = {
      cancel: true,
      continuous: true,
      create_target: true,
      doc_ids: true,
      filter: true,
      proxy: true,
      source: true,
      target: true
    }

    let couchParams = replicators._toCouchDBReplicationParams(params)

    couchParams.should.eql({
      create_target: true,
      doc_ids: true,
      filter: true,
      proxy: true,
      source: true,
      target: true
    })
  })
})
