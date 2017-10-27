'use strict'

const ChangeListeners = require('../../src/change-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

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
    testUtils.spy(listeners, ['_upsert', '_changesArray', '_onError'], calls)
  }

  const fakeSlouchChangesArray = () => {
    listeners._slouchChangesArray = sporks.resolveFactory()
  }

  beforeEach(async () => {
    suffix = testUtils.nextSuffix()
    listeners = new ChangeListeners(testUtils.spiegel)
    listenerIds = []
    onChangeIds = []
    spy()
  })

  afterEach(async () => {
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
  })

  it('should get changes when last_seq undefined', () => {
    fakeSlouchChangesArray()
    listeners._batchSize = 10
    listeners._changes({ db_name: 'test_db1' })
    calls._changesArray[0][0].should.eql('test_db1')
    calls._changesArray[0][1].should.eql({ since: undefined, include_docs: true, limit: 10 })
  })

  it('should get changes when last_seq defined', () => {
    fakeSlouchChangesArray()
    listeners._changes({ db_name: 'test_db1', last_seq: 'last-seq' })
    calls._changesArray[0][1].should.eql({ since: 'last-seq', include_docs: true, limit: 100 })
  })

  it('should process changes sequentially', async () => {
    // Fake long processChange so that we can ensure the changes are being processed sequentially
    let changesProcessed = []
    listeners._processChange = change => {
      changesProcessed.push(change)
      return sporks.timeout(100)
    }

    let changes = {
      results: [{ doc: { thing: 'jam' } }, { doc: { thing: 'code' } }]
    }

    await listeners._processChanges({ db_name: 'test_db1' }, changes)

    changesProcessed.should.eql([{ doc: { thing: 'jam' } }, { doc: { thing: 'code' } }])
  })

  it('should _moreBatches', () => {
    listeners._moreBatches({ pending: 0 }).should.eql(false)
    listeners._moreBatches({ pending: 10 }).should.eql(true)
  })

  const createTestDBs = async () => {
    await testUtils.createTestDBs(['test_db1' + suffix, 'test_db3' + suffix])
  }

  const createListener = async () => {
    listener = await listeners._create({ db_name: 'test_db1' + suffix })
    listenerIds[listener.id] = true
    listener = await listeners._get(listener.id)
  }

  const setUpForBatchOfChanges = async () => {
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

    await createTestDBs()
  }

  it('should _processBatchOfChanges', async () => {
    await setUpForBatchOfChanges()

    let moreBatches = await listeners._processBatchOfChanges(listener)
    moreBatches.should.eql(false)

    // Check requests
    requests.length.should.eql(1)
    requests[0].should.eql({ url: 'https://example.com', method: 'GET', qs: {} })
  })

  it('_processBatchOfChangesLogError should handle error', async () => {
    // Fake error
    let err = new Error()
    listeners._processBatchOfChanges = sporks.promiseErrorFactory(err)

    await createListener()
    let leaveDirty = await listeners._processBatchOfChangesLogError(listener)

    // Should be left dirty so that it can be retried
    leaveDirty.should.eql(true)

    calls._onError[0][0].should.eql(err)
  })

  it('should process', async () => {
    await setUpForBatchOfChanges()

    await listeners._process(listener)

    // Check requests
    requests.length.should.eql(1)
    requests[0].should.eql({ url: 'https://example.com', method: 'GET', qs: {} })
  })
})
