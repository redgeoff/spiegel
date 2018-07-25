'use strict'

const ChangeListeners = require('../../src/change-listeners')
const { DatabaseNotFoundError } = require('../../src/errors')
const testUtils = require('../utils')
const sporks = require('sporks')
const sandbox = require('sinon').createSandbox()

describe('change-listeners', () => {
  let listeners = null
  let listenerIds = null
  let onChangeIds = null
  let calls = null
  let suffix = null
  let listener = null
  let requests = null

  const spy = () => {
    calls = []
    testUtils.spy(listeners, ['_upsert', '_changesArray', '_onError', '_waitForRequests'], calls)
  }

  const fakeSlouchChangesArray = () => {
    listeners._slouchChangesArray = sporks.resolveFactory()
  }

  beforeEach(async() => {
    suffix = testUtils.nextSuffix()
    listeners = new ChangeListeners(testUtils.spiegel)
    listenerIds = []
    onChangeIds = []
    spy()
  })

  afterEach(async() => {
    if (listeners._spiegel._onChanges.isRunning()) {
      await listeners._spiegel._onChanges.stop()
    }

    let ids = sporks.keys(listenerIds)
    await Promise.all(
      ids.map(async id => {
        await listeners._getAndDestroy(id)
      })
    )

    await Promise.all(
      onChangeIds.map(async id => {
        await listeners._spiegel._onChanges._getAndDestroy(id)
      })
    )

    await testUtils.destroyTestDBs()

    sandbox.restore()
  })

  it('should get changes when last_seq undefined', () => {
    fakeSlouchChangesArray()
    listeners._batchSize = 10
    listeners._changesForListener({ db_name: 'test_db1' })
    calls._changesArray[0][0].should.eql('test_db1')
    calls._changesArray[0][1].should.eql({ since: undefined, include_docs: true, limit: 10 })
  })

  it('should get changes when last_seq defined', () => {
    fakeSlouchChangesArray()
    listeners._changesForListener({ db_name: 'test_db1', last_seq: 'last-seq' })
    calls._changesArray[0][1].should.eql({ since: 'last-seq', include_docs: true, limit: 100 })
  })

  it('should throw DatabaseNotFoundError for missing database', () => {
    let throwStub = sandbox.stub(listeners, '_changesArray')
    throwStub.rejects({'error': 'not_found'})
    return listeners._processBatchOfChangesLogError({ db_name: 'test_db1' })
      .then(() => {
        throw new Error('should throw error')
      })
      .catch(err => {
        err.should.instanceOf(DatabaseNotFoundError)
      })
  })

  it('should not throw DatabaseNotFoundError for other errors', () => {
    let throwStub = sandbox.stub(listeners, '_changesArray')
    throwStub.rejects({'error': 'something_else'})
    return listeners._processBatchOfChangesLogError({ db_name: 'test_db1' })
      .then(() => {
        throw new Error('should throw error')
      })
      .catch(err => {
        err.should.not.instanceOf(DatabaseNotFoundError)
      })
  })

  it('should process changes sequentially', async() => {
    // Fake long processChange so that we can ensure the changes are being processed sequentially
    let changesProcessed = []
    listeners._processChange = (change, dbName, requests) => {
      changesProcessed.push(change)
      let r = sporks.timeout(100)
      requests.push(r)
      return r
    }

    let changes = {
      results: [{ doc: { thing: 'jam' } }, { doc: { thing: 'code' } }]
    }

    await listeners._processChanges({ db_name: 'test_db1' }, changes)

    changesProcessed.should.eql([{ doc: { thing: 'jam' } }, { doc: { thing: 'code' } }])

    // Sanity check that we wait for all promises to resolve before batch is considered done
    calls._waitForRequests[0][0].length.should.eql(2)
  })

  it('should _moreBatches', () => {
    listeners._moreBatches({ pending: 0 }).should.eql(false)
    listeners._moreBatches({ pending: 10 }).should.eql(true)
  })

  const createTestDBs = async() => {
    await testUtils.createTestDBs(['test_db1' + suffix, 'test_db3' + suffix])
  }

  const createListener = async() => {
    listener = await listeners._create({ db_name: 'test_db1' + suffix })
    listenerIds[listener.id] = true
    listener = await listeners._get(listener.id)
  }

  const setUpForBatchOfChanges = async() => {
    await listeners._spiegel._onChanges.start()

    await createListener()

    // Fake request so that we don't actually hit an API
    requests = []
    listeners._changeProcessor._request = opts => {
      requests.push(opts)
      return Promise.resolve()
    }

    let onChange = await listeners._spiegel._onChanges._create({
      db_name: 'test_db1' + suffix,
      url: 'https://example.com'
    })
    onChangeIds.push(onChange.id)

    // Wait for PouchDB instance to receive OnChange
    await testUtils.waitFor(() => {
      let docs = listeners._spiegel._onChanges._docs
      return sporks.length(docs) > 0 ? true : undefined
    })

    await createTestDBs()
  }

  it('should _processBatchOfChanges', async() => {
    await setUpForBatchOfChanges()

    let moreBatches = await listeners._processBatchOfChanges(listener)
    moreBatches.should.eql(false)

    // Check requests
    requests.length.should.eql(1)
    requests[0].should.eql({ url: 'https://example.com', method: 'GET', qs: {} })
  })

  it('_processBatchOfChangesLogError should handle error', async() => {
    // Fake error
    let err = new Error()
    listeners._processBatchOfChanges = sporks.promiseErrorFactory(err)

    await createListener()
    let leaveDirty = await listeners._processBatchOfChangesLogError(listener)

    // Should be left dirty so that it can be retried
    leaveDirty.should.eql(true)

    calls._onError[0][0].should.eql(err)
  })

  it('should process', async() => {
    await setUpForBatchOfChanges()

    await listeners._process(listener)

    // Check requests
    requests.length.should.eql(1)
    requests[0].should.eql({ url: 'https://example.com', method: 'GET', qs: {} })
  })

  it('should remove duplicate conflicted db names', async() => {
    // Fake
    listeners._dirtyOrCreate = function() {
      return Promise.resolve([
        {
          error: 'conflict'
        },
        {
          error: 'conflict'
        }
      ])
    }

    let dbNames = await listeners._dirtyAndGetConflictedDBNames([
      {
        db_name: 'db1'
      },
      {
        db_name: 'db1'
      }
    ])
    dbNames.should.eql(['db1'])
  })
})
