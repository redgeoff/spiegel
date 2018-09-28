'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')
const sandbox = require('sinon').createSandbox()

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
    sandbox.restore()

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

  it('should pass same date on recursive call to dirtyIfCleanOrLocked', async() => {
    sandbox.stub(replicators, '_attemptToDirtyIfCleanOrLocked')
      .onFirstCall().returns(['fred'])
      .onSecondCall().returns([])

    let spy = sandbox.spy(replicators, 'dirtyIfCleanOrLocked')

    await replicators.dirtyIfCleanOrLocked(['fred'], 'passedInDate')

    spy.callCount.should.eql(2)
    spy.getCall(1).args[1].should.eql('passedInDate')
  })

  it('should queue soiler for immediate update after dirtying', async() => {
    sandbox.stub(replicators, '_attemptToDirtyIfCleanOrLocked')
      .onFirstCall().returns([])

    let stub = sandbox.stub(replicators, '_queueSoiler')

    await replicators.dirtyIfCleanOrLocked(['fred'], new Date())
    stub.callCount.should.eql(1)
    stub.getCall(0).args[0].should.eql(0)
  })

  it('should set dirtyAt only if dirty_after_milliseconds set', async() => {
    let dirtyAtStub = sandbox.stub(replicators, '_setDirtyAt')
    let dirtyStub = sandbox.stub(replicators, '_setDirty')
    sandbox.stub(replicators, '_setUpdatedAt')
    sandbox.stub(replicators._slouch.doc, 'bulkCreateOrUpdate')

    this.clock = sandbox.useFakeTimers()

    let expectedDate = new Date(new Date().getTime() + 200).toISOString()

    let item = { id: 'fred', dirty_after_milliseconds: 200 }
    await replicators._dirty([item], new Date())
    dirtyAtStub.callCount.should.eql(1)
    dirtyStub.callCount.should.eql(0)
    dirtyAtStub.getCall(0).args[0].should.eql(item)
    dirtyAtStub.getCall(0).args[1].should.eql(expectedDate)

    dirtyAtStub.reset()
    dirtyStub.reset()

    item = { id: 'barney' }
    await replicators._dirty([item], new Date())

    dirtyAtStub.callCount.should.eql(0)
    dirtyStub.callCount.should.eql(1)
    dirtyStub.getCall(0).args[0].should.eql(item)
  })
})
