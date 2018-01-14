'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')

describe('replicators', () => {
  let replicators = null
  let replicatorIds = null
  let globalError = false
  let retryAfterSeconds = 1
  let checkStalledSeconds = 1
  let calls = null

  let conflictError = new Error()
  conflictError.error = 'conflict'

  const listenForErrors = () => {
    replicators.once('err', function(err) {
      globalError = err
    })
  }

  const spy = () => {
    calls = []
    testUtils.spy(
      replicators,
      ['_toCouchDBReplicationParams', '_addPassword', '_censorPasswordInURL', '_slouchReplicate'],
      calls
    )
  }

  beforeEach(async() => {
    replicators = new Replicators(testUtils.spiegel, { retryAfterSeconds, checkStalledSeconds })
    calls = []
    spy()
    replicatorIds = []
    listenForErrors()
  })

  afterEach(async() => {
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

  it('should extract db name', function() {
    replicators._toDBName('http://example.com:5984/mydb').should.eql('mydb')

    // We don't really care about this case as we require the source to be a FQDN
    testUtils.shouldEqual(replicators._toDBName('mydb'), undefined)

    testUtils.shouldEqual(replicators._toDBName(''), undefined)

    testUtils.shouldEqual(replicators._toDBName(), undefined)
  })

  it('should convert to CouchDB replication params', async() => {
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

  it('_censorPasswordInURL should handle falsy values', () => {
    testUtils.shouldEqual(replicators._censorPasswordInURL(null), null)
  })

  it('should _replicate', async() => {
    // Note: this test is needed as otherwise a race condition could lead to not having complete
    // test coverage of the replication

    // Fake
    calls._slouchReplicate = []
    replicators._slouchReplicate = function() {
      calls._slouchReplicate.push(arguments)
      return Promise.resolve()
    }

    let params = {
      source: 'https://example.com/db1',
      target: 'https://example.com/db2'
    }
    await replicators._replicate(params)

    // Sanity checks
    calls._toCouchDBReplicationParams.length.should.eql(1)
    calls._addPassword.length.should.eql(2)
    calls._censorPasswordInURL.length.should.eql(2)
    calls._slouchReplicate[0][0].should.eql(params)
  })

  it('should remove duplicate conflicted db names', async() => {
    // Fake
    replicators._dirty = function() {
      return Promise.resolve([
        {
          error: 'conflict'
        },
        {
          error: 'conflict'
        }
      ])
    }

    let dbNames = await replicators._dirtyAndGetConflictedDBNames([
      {
        source: 'https://example.com/db1'
      },
      {
        source: 'https://example.com/db1'
      }
    ])
    dbNames.should.eql(['db1'])
  })
})
