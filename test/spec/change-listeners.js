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

  const dirtyListener = async () => {
    await listeners.dirtyIfClean('test_db1')
    listenerIds[listeners._toId('test_db1')] = true
    return listeners._getByDBName('test_db1')
  }

  it('should dirty when missing', async () => {
    let listener = await dirtyListener()
    listener._id.should.eql(listeners._idPrefix + 'test_db1')
    listener.db_name.should.eql('test_db1')
    listener.type.should.eql('change_listener')
    listener.dirty.should.eql(true)
  })

  it('should dirty when clean', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Clean listener
    let lastSeq = '123'
    await listeners._cleanAndUnlock(listener, lastSeq)

    // Dirty the clean listener
    await listeners.dirtyIfClean('test_db1')

    // Make sure it is now dirty and the lastSeq was preserved
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(true)
    listener.last_seq.should.eql(lastSeq)
  })

  it('should do nothing when already dirty', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Make sure upsert was called
    calls._upsert.length.should.eql(1)

    // Attempt to dirty listener
    listener = await dirtyListener()

    // Make sure listener is still dirty
    listener.dirty.should.eql(true)

    // Make sure upsert was not called again
    calls._upsert.length.should.eql(1)
  })

  it('lock listener', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Lock listener
    let lockedListener = await listeners.lock(listener)

    // Get the saved listener and compare
    let savedListener = await listeners._getByDBName('test_db1')
    savedListener.should.eql(lockedListener)

    // The rev should have changed
    lockedListener._rev.should.not.eql(listener._rev)

    // The locked_at value should have been populated
    lockedListener.locked_at.should.not.eql(undefined)

    // The updated_at value should have been populated
    lockedListener.updated_at.should.not.eql(undefined)
  })

  it('lock should throw when conflict', async () => {
    // Create listener
    let listener = await dirtyListener()

    // Modify listener to simulate a conflict later
    listener.dirty = true
    await testUtils.spiegel._slouch.doc.update(testUtils.spiegel._dbName, listener)

    let savedListener1 = await listeners._getByDBName(listener.db_name)

    let err = null
    try {
      // Lock listener
      await listeners.lock(listener)
    } catch (_err) {
      err = _err
    }
    testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)

    // Get the saved listener and make sure nothing changed
    let savedListener2 = await listeners._getByDBName(listener.db_name)
    savedListener2.should.eql(savedListener1)
  })

  it('should clean and unlock listener', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Lock listener
    listener = await listeners.lock(listener)

    // Clean listener
    let lastSeq = '123'
    await listeners._cleanAndUnlock(listener, lastSeq)

    // Make sure it is now clean and the lastSeq was set
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(false)
    listener.last_seq.should.eql(lastSeq)
    testUtils.shouldEqual(listener.locked_at, undefined)
  })

  it('cleanAndUnlockOrUpdateLastSeq should clean and unlock', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Clean listener
    let lastSeq = '123'
    await listeners.cleanAndUnlockOrUpdateLastSeq(listener, lastSeq)

    // Make sure it is now clean and the lastSeq was set
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(false)
    listener.last_seq.should.eql(lastSeq)
  })

  it('cleanAndUnlockOrUpdateLastSeq should update', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Update the lastSeq to prepare for the conflict
    await listeners._updateLastSeq(listener._id, '123')

    // Attempt to clean, but actually set last seq
    let lastSeq = '222'
    await listeners.cleanAndUnlockOrUpdateLastSeq(listener, lastSeq)

    // Make sure it is still dirty, but the lastSeq was updated
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(true)
    listener.last_seq.should.eql(lastSeq)
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
})
