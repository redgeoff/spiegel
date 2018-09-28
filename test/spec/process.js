'use strict'

const Process = require('../../src/process')
const { DatabaseNotFoundError } = require('../../src/errors')
const testUtils = require('../utils')
const sporks = require('sporks')
const utils = require('../../src/utils')
const EventEmitter = require('events').EventEmitter
const config = require('../../src/config.json')
const sandbox = require('sinon').createSandbox()

describe('process', () => {
  let globalProc = null
  let proc = null
  let itemIds = null
  let calls = null
  let globalError = false
  let retryAfterSeconds = 1
  let checkStalledSeconds = 1
  let assumeDeletedAfterSeconds = 1
  let type = 'item'

  let conflictError = new Error()
  conflictError.error = 'conflict'

  let nonConflictError = new Error()

  const spy = () => {
    calls = []
    testUtils.spy(
      proc,
      [
        '_lockAndThrowIfErrorAndNotConflict',
        '_processAndUnlockIfError',
        '_unlockAndCleanIfConflictJustUnlock',
        '_upsertUnlock',
        '_lockProcessUnlockLogError',
        '_changes',
        '_unlockStalled',
        '_unlock',
        '_onError',
        '_logFatal',
        '_clearConflicts',
        '_updateItem',
        '_getAndDestroy',
        '_stopSoiler',
        '_queueSoiler',
        '_soilPendingItems',
        '_soilItem'
      ],
      calls
    )
  }

  const listenForErrors = () => {
    proc.once('err', function(err) {
      globalError = err
    })
  }

  const ignoreGlobalErrors = () => {
    // Fake emitting of error so that we don't actually emit an error
    proc.emit = () => {}
  }

  before(async() => {
    globalProc = new Process(
      testUtils.spiegel,
      { retryAfterSeconds, checkStalledSeconds, assumeDeletedAfterSeconds },
      type
    )
    await globalProc._createViews()
  })

  after(async() => {
    await globalProc._destroyViews()
  })

  beforeEach(async() => {
    proc = new Process(
      testUtils.spiegel,
      { retryAfterSeconds, checkStalledSeconds, assumeDeletedAfterSeconds },
      type
    )
    itemIds = []
    spy()
    listenForErrors()
  })

  // TODO: move to slouch
  const downsert = (dbName, id) => {
    return testUtils.spiegel._slouch.doc._persistThroughConflicts(function() {
      return testUtils.spiegel._slouch.doc.getAndDestroy(dbName, id)
    })
  }

  afterEach(async() => {
    await Promise.all(
      itemIds.map(async id => {
        // We need to use a downsert as we need to handle race conditions caused when we have
        // multiple nodes
        await downsert(testUtils.spiegel._dbName, id)
      })
    )
    await testUtils.destroyTestDBs()

    sandbox.restore()

    // Was there an error?
    if (globalError) {
      throw globalError
    }
  })

  const createItem = async item => {
    item.type = type
    let doc = await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, item)
    itemIds.push(doc.id)
    return {
      _id: doc.id,
      _rev: doc.rev
    }
  }

  const createTestItem = async() => {
    let rep = await createItem({
      source: 'https://example.com/test_db1'
    })
    return proc._get(rep._id)
  }

  const fakeSuccessfulProcessing = () => {
    proc._process = sporks.resolveFactory()
  }

  it('should lock item', async() => {
    // Create item
    let item = await createItem({
      source: 'https://example.com/test_db1'
    })

    // Lock item
    let lockedItem = await proc._lock(item)

    // Get the saved item and compare
    let savedItem = await proc._get(item._id)
    savedItem.should.eql(lockedItem)

    // The rev should have changed
    lockedItem._rev.should.not.eql(item._rev)

    // The locked_at value should have been populated
    lockedItem.locked_at.should.not.eql(undefined)

    // The updated_at value should have been populated
    lockedItem.updated_at.should.not.eql(undefined)
  })

  const shouldThrowWhenConflict = async opName => {
    // Create item
    let item = await createItem({
      source: 'https://example.com/test_db1'
    })

    // Modify item to simulate a conflict later
    item.dirty = true
    await testUtils.spiegel._slouch.doc.update(testUtils.spiegel._dbName, item)

    let savedItem1 = await proc._get(item._id)

    let err = null
    try {
      // Lock item
      await proc[opName](item)
    } catch (_err) {
      err = _err
    }
    testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)

    // Get the saved item and make sure nothing changed
    let savedItem2 = await proc._get(item._id)
    savedItem2.should.eql(savedItem1)
  }

  it('lock should throw when conflict', async() => {
    await shouldThrowWhenConflict('_lock')
  })

  it('unlock should throw when conflict', async() => {
    await shouldThrowWhenConflict('_unlock')
  })

  const shouldUpsertUnlock = async simulateConflict => {
    // Create item
    let item = await createItem({
      source: 'https://example.com/test_db1',
      locked_at: new Date().toISOString(),
      dirty: true
    })

    // Get saved item
    let savedItem1 = await proc._get(item._id)

    if (simulateConflict) {
      // Simulate conflict
      await proc._updateItem(savedItem1)
      let savedItem1a = await proc._get(item._id)
      savedItem1a._rev.should.not.eql(savedItem1._rev)
    }

    // Upsert unlock
    await proc._upsertUnlock(item)

    // Get saved item
    let savedItem2 = await proc._get(item._id)

    // It should be unlocked
    testUtils.shouldEqual(savedItem2.locked_at, null)

    // Other attrs like dirty should not have changed
    savedItem2.dirty.should.eql(true)

    // updated_at should have changed
    savedItem2.updated_at.should.not.eql(savedItem1.updated_at)

    // rev should be different
    savedItem2._rev.should.not.eql(savedItem1._rev)
  }

  it('should upsert unlock', async() => {
    await shouldUpsertUnlock()
  })

  it('should upsert unlock when conflict', async() => {
    await shouldUpsertUnlock(true)
  })

  const shouldUnlockAndClean = async simulateConflict => {
    // Create item
    let item = await createItem({
      source: 'https://example.com/test_db1',
      locked_at: new Date().toISOString(),
      dirty: true
    })

    // Get saved item
    let savedItem1 = await proc._get(item._id)

    let savedItem1a = null
    if (simulateConflict) {
      // Simulate conflict
      await proc._updateItem(savedItem1)
      savedItem1a = await proc._get(item._id)
      savedItem1a._rev.should.not.eql(savedItem1._rev)
    }

    let err = null
    try {
      // Unlock and clean
      await proc._unlockAndClean(item)
    } catch (_err) {
      err = _err
    }

    // Get saved item
    let savedItem2 = await proc._get(item._id)

    if (simulateConflict) {
      testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)

      // It should remain locked
      savedItem2.locked_at.should.eql(savedItem2.locked_at)

      // Should remain dirty
      savedItem2.dirty.should.eql(true)

      // updated_at should not have changed
      savedItem2.updated_at.should.eql(savedItem1a.updated_at)

      // rev should not be different
      savedItem2._rev.should.eql(savedItem1a._rev)
    } else {
      // It should be unlocked
      testUtils.shouldEqual(savedItem2.locked_at, null)

      // Should be clean
      savedItem2.dirty.should.eql(false)

      // updated_at should have changed
      savedItem2.updated_at.should.not.eql(savedItem1.updated_at)

      // rev should be different
      savedItem2._rev.should.not.eql(savedItem1._rev)
    }
  }

  it('should unlock and clean', async() => {
    await shouldUnlockAndClean()
  })

  it('should not unlock and clean when conflict', async() => {
    await shouldUnlockAndClean(true)
  })

  it('_lockProcessUnlock should handle non-conflict error when locking', async() => {
    let item = await createTestItem()

    // Fake non-conflict error
    proc._lock = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return proc._lockProcessUnlock(item)
    }, nonConflictError)

    // Make sure other calls are then skipped
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(0)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockProcessUnlock should handle conflict when locking', async() => {
    let item = await createTestItem()

    // Fake conflict error
    proc._lock = sporks.promiseErrorFactory(conflictError)

    await proc._lockProcessUnlock(item)

    // Make sure other calls are then skipped
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(0)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockProcessUnlock should handle error when processing', async() => {
    let item = await createTestItem()

    // Fake conflict error
    proc._process = sporks.promiseErrorFactory(conflictError)

    await sporks.shouldThrow(() => {
      return proc._lockProcessUnlock(item)
    }, conflictError)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockProcessUnlock should handle non-conflict error when cleaning', async() => {
    let item = await createTestItem()

    fakeSuccessfulProcessing()

    // Fake non-conflict error
    proc._unlockAndClean = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return proc._lockProcessUnlock(item)
    }, nonConflictError)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(0)
  })

  it('_lockProcessUnlock should handle conflict error when cleaning', async() => {
    let item = await createTestItem()

    fakeSuccessfulProcessing()

    // Fake conflict error
    proc._unlockAndClean = sporks.promiseErrorFactory(conflictError)

    await proc._lockProcessUnlock(item)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(1)
  })

  it('should _lockProcessUnlock without errors', async() => {
    let item = await createTestItem()

    fakeSuccessfulProcessing()

    await proc._lockProcessUnlock(item)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(0)
  })

  const testDBNames = () => {
    return ['test_db1' + testUtils.nextSuffix(), 'test_db2' + testUtils.nextSuffix()]
  }

  const createItems = async dbNames => {
    await createItem({
      source: utils.couchDBURL() + '/' + dbNames[0],
      target: utils.couchDBURL() + '/' + dbNames[0],
      dirty: true
    })

    await createItem({
      source: utils.couchDBURL() + '/' + dbNames[1],
      target: utils.couchDBURL() + '/' + dbNames[1],
      dirty: true
    })
  }

  const lockReplicateUnlockLogErrorShouldEql = dbNames => {
    calls._lockProcessUnlockLogError.length.should.eql(2)

    // Order is not guaranteed so we index by source
    let indexedItems = {}
    calls._lockProcessUnlockLogError.forEach(args => {
      indexedItems[args[0].source] = { source: args[0].source, target: args[0].target }
    })
    indexedItems[utils.couchDBURL() + '/' + dbNames[0]].source.should.eql(
      utils.couchDBURL() + '/' + dbNames[0]
    )
    indexedItems[utils.couchDBURL() + '/' + dbNames[0]].target.should.eql(
      utils.couchDBURL() + '/' + dbNames[0]
    )
    indexedItems[utils.couchDBURL() + '/' + dbNames[1]].source.should.eql(
      utils.couchDBURL() + '/' + dbNames[1]
    )
    indexedItems[utils.couchDBURL() + '/' + dbNames[1]].target.should.eql(
      utils.couchDBURL() + '/' + dbNames[1]
    )
  }

  it('should start when proc already dirty', async() => {
    let dbNames = testDBNames()

    await createItems(dbNames)

    await testUtils.createTestDBs(dbNames)

    await proc.start()

    // Verify start with lastSeq. 1st entry is the _getLastSeq() called by _start() and then finally
    // the call by _listen()
    testUtils.shouldNotEqual(calls._changes[1][0].since, undefined)

    lockReplicateUnlockLogErrorShouldEql(dbNames)

    await proc.stop()
  })

  it('should start with no proc dirty', async() => {
    let dbNames = testDBNames()

    await proc.start()

    await createItems(dbNames)

    await testUtils.createTestDBs(dbNames)

    await testUtils.waitFor(() => {
      return calls._lockProcessUnlockLogError.length === 2 ? true : undefined
    })

    lockReplicateUnlockLogErrorShouldEql(dbNames)

    await proc.stop()
  })

  // In production, conflicts will occur when the same doc is changed on different nodes
  // simultaneously and then these docs are replicated. The only reliable way to reproduce this case
  // in our tests is to use replication.
  const createConflictViaReplication = async() => {
    // Create DB that we can use for replication
    let dbName = 'test_db3' + testUtils.nextSuffix()
    await testUtils.createDB(dbName)

    // Note: we use getMergeUpsert below as we are changing data that may also be changed
    // simultaneously by Spiegel

    // Note: assuming we are testing against CouchDB running in a Docker container, the port is
    // always 5984 as this is the local port as seen from within the container.
    let url =
      config.couchdb.scheme +
      '://' +
      config.couchdb.username +
      ':' +
      config.couchdb.password +
      '@' +
      config.couchdb.host +
      ':5984'

    // Replicate the spiegel DB
    await testUtils.spiegel._slouch.db.replicate({
      source: url + '/' + testUtils.spiegel._dbName,
      target: url + '/' + dbName
    })

    // Change the new doc
    await testUtils.spiegel._slouch.doc.getMergeUpsert(dbName, {
      _id: itemIds[0],
      new_data: new Date().toISOString(),
      dirty: true
    })

    // Change the old doc
    await testUtils.spiegel._slouch.doc.getMergeUpsert(testUtils.spiegel._dbName, {
      _id: itemIds[0],
      new_data: new Date().toISOString(),
      dirty: true
    })

    // Replicate back to create the conflict
    await testUtils.spiegel._slouch.db.replicate({
      source: url + '/' + dbName,
      target: url + '/' + testUtils.spiegel._dbName
    })

    // Update the old doc to trigger spiegel to process it
    await testUtils.spiegel._slouch.doc.getMergeUpsert(testUtils.spiegel._dbName, {
      _id: itemIds[0],
      new_data: new Date().toISOString(),
      dirty: true
    })
  }

  it('should resolve conflicts', async() => {
    // We need to ignore Spiegel errors as we are changing data that may also be modified
    // simultaneously by Spiegel and this can very easily cause conflict errors
    ignoreGlobalErrors()

    let dbNames = testDBNames()

    await proc.start()

    await createItems(dbNames)

    await testUtils.createTestDBs(dbNames)

    await createConflictViaReplication()

    await testUtils.waitFor(() => {
      return calls._clearConflicts.length === 1 ? true : undefined
    })

    // Make sure a conflict was read
    calls._clearConflicts[0][0]._conflicts.length.should.eql(1)

    // Trigger another item
    await testUtils.spiegel._slouch.doc.getMergeUpsert(testUtils.spiegel._dbName, {
      _id: itemIds[0],
      new_data: new Date().toISOString(),
      dirty: true
    })

    await testUtils.waitFor(() => {
      return calls._lockProcessUnlockLogError.length >= 5 ? true : undefined
    })

    // Make sure the conflicts have been cleared
    testUtils.shouldEqual(calls._lockProcessUnlockLogError[4]._conflicts, undefined)

    await proc.stop()
  })

  it('should swallow conflict when clearing conflicts', async() => {
    // Fake non-conflict error
    proc._destroyConflicts = sporks.promiseErrorFactory(conflictError)

    await proc._clearConflicts()
  })

  it('should throw error when clearing conflicts', async() => {
    // Fake conflict error
    proc._destroyConflicts = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return proc._clearConflicts()
    }, nonConflictError)
  })

  it('should unstall', async() => {
    let dbNames = testDBNames()

    let item1 = await createItem({
      source: utils.couchDBURL() + '/' + dbNames[0],
      target: utils.couchDBURL() + '/' + dbNames[0],
      dirty: true,

      // Should be retried when unstaller a subsequent time. We add the multiple of 2 or else a race
      // condition could cause this item to be processed in the first batch
      locked_at: new Date(new Date().getTime() + retryAfterSeconds * 1000 * 2).toISOString()
    })

    // A decoy that should not be unstalled as it is not locked
    await createItem({
      source: utils.couchDBURL() + '/' + dbNames[1],
      target: utils.couchDBURL() + '/' + dbNames[1],
      dirty: true
    })

    let item3 = await createItem({
      source: utils.couchDBURL() + '/' + dbNames[1],
      target: utils.couchDBURL() + '/' + dbNames[1],
      dirty: true,

      // Should be retried when unstaller first runs
      locked_at: new Date(new Date().getTime() - retryAfterSeconds * 1000).toISOString()
    })

    await testUtils.createTestDBs(dbNames)

    await proc.start()

    // Wait for 2 unlocks
    await testUtils.waitFor(() => {
      return calls._unlock.length === 2 ? true : undefined
    })

    calls._unlock[0][0]._id.should.eql(item3._id)
    calls._unlock[1][0]._id.should.eql(item1._id)

    // Make sure _unlockStalled was called mutiple times
    calls._unlockStalled.length.should.above(1)

    await proc.stop()
  })

  it('_setClean should not clean when leaveDirty', () => {
    let item = { dirty: true }
    proc._setClean(item, true)
    item.should.eql({ dirty: true })
  })

  it('_setDirty should set dirty flag and clear dirty_at', () => {
    let item = {}
    proc._setDirty(item)
    item.should.eql({ dirty: true, dirty_at: null })
  })

  it('_setDirtyAt should set dirty_at and clear the dirty flag', () => {
    let item = {}
    proc._setDirtyAt(item, 'theDate')
    item.should.eql({ dirty: false, dirty_at: 'theDate' })
  })

  it('_lockProcessUnlockLogError should handle error', async() => {
    // Fake conflict error
    proc._lockProcessUnlock = sporks.promiseErrorFactory(conflictError)

    ignoreGlobalErrors()

    await proc._lockProcessUnlockLogError()

    // Make sure _onError was called
    calls._onError[0][0].should.eql(conflictError)
  })

  it('should _listenToIteratorErrors', () => {
    let emitter = new EventEmitter()

    proc._listenToIteratorErrors(emitter)

    ignoreGlobalErrors()

    // Fake error
    emitter.emit('error', conflictError)

    // Make sure _logFatal was called
    calls._logFatal[0][0].should.eql(conflictError)
  })

  it('should stop when not already started', async() => {
    await proc.stop()
  })

  it('_unlockAndThrowIfNotConflict should throw if not conflict', async() => {
    // Fake non-conflict error
    proc._unlock = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return proc._unlockAndThrowIfNotConflict()
    }, nonConflictError)
  })

  it('_unlockAndThrowIfNotConflict should not throw if conflict', async() => {
    // Fake non-conflict error
    proc._unlock = sporks.promiseErrorFactory(conflictError)

    await proc._unlockAndThrowIfNotConflict()
  })

  it('_unlockStalledLogError should log errors', async() => {
    // Fake conflict error
    proc._unlockStalled = sporks.promiseErrorFactory(conflictError)

    ignoreGlobalErrors()

    await proc._unlockStalledLogError()

    // Make sure _onError was called
    calls._onError[0][0].should.eql(conflictError)
  })

  it('should log fatal errors when listening', async() => {
    // Fake error
    let err = new Error()
    proc._changes = () => {
      throw err
    }

    await proc._listen()

    calls._logFatal[0][0].should.eql(err)
  })

  it('should get dirty and unlocked', async() => {
    let item1 = await createItem({})

    let item2 = await createItem({
      dirty: true
    })

    await createItem({
      dirty: false
    })

    let item4 = await createItem({
      dirty: true,
      locked_at: null
    })

    await createItem({
      dirty: true,
      locked_at: new Date().toISOString()
    })

    let items = {}
    await proc._dirtyAndUnlocked().each(item => {
      // Order is not guaranteed so index by id
      items[item.doc._id] = item.doc
    })

    sporks.length(items).should.eql(3)
    testUtils.shouldNotEqual(items[item1._id], undefined)
    testUtils.shouldNotEqual(items[item2._id], undefined)
    testUtils.shouldNotEqual(items[item4._id], undefined)
  })

  it('should upsert unlock and dirty when locked', async() => {
    // Fake and spy
    let calls = []
    proc._updateItem = function() {
      calls.push(arguments)
    }

    await proc._upsertUnlockAndDirtyIfLocked({ _id: '1', locked_at: new Date().toISOString() })

    calls[0][0].should.eql({ _id: '1', locked_at: null, dirty: true, possibly_deleted_at: null })
    calls[0][1].should.eql(true)
  })

  it('should not upsert unlock or dirty when not locked', async() => {
    await proc._upsertUnlockAndDirtyIfLocked({ _id: '1', locked_at: null })

    calls._updateItem.length.should.eql(0)
  })

  it('can tell if a database has probably been deleted', () => {
    proc._isProbablyDeleted({ possibly_deleted_at: null }).should.eql(false)

    this.clock = sandbox.useFakeTimers()

    let now = new Date()
    let nowString = now.toISOString()

    this.clock.tick(500)

    proc._isProbablyDeleted({ possibly_deleted_at: nowString }).should.eql(false)

    this.clock.tick(501)

    proc._isProbablyDeleted({ possibly_deleted_at: nowString }).should.eql(true)

    // We used to check updated_at, make sure it isn't referenced anymore
    proc._isProbablyDeleted({ updated_at: nowString }).should.eql(false)

    this.clock.restore()
  })

  it('_processAndUnlockIfError should destroy item on DatabaseNotFoundError', () => {
    let theItem = { _id: 'foo' }

    sandbox.stub(proc, '_process').rejects(new DatabaseNotFoundError('fakeDb'))
    sandbox.stub(proc, '_isProbablyDeleted').returns(true)
    let destroyStub = sandbox.stub(proc, '_getAndDestroy')

    return proc
      ._processAndUnlockIfError(theItem)
      .catch(err => {
        err.should.instanceOf(DatabaseNotFoundError)
      })
      .then(() => {
        sandbox.assert.calledWith(destroyStub, 'foo')
      })
  })

  it('should try to soil items after appropriate delay', async() => {
    this.clock = sandbox.useFakeTimers()

    let d = new Date(new Date().getTime() + 100)
    proc._queueSoiler(d.toISOString())

    calls._stopSoiler.length.should.eql(1)
    calls._soilPendingItems.length.should.eql(0)

    this.clock.tick(99)
    calls._soilPendingItems.length.should.eql(0)

    this.clock.tick(1)
    calls._soilPendingItems.length.should.eql(1)

    this.clock.restore()
  })

  it('should not requeue for a later delay, but should for an earlier one', async() => {
    this.clock = sandbox.useFakeTimers()

    let d = new Date(new Date().getTime() + 100)
    proc._queueSoiler(d.toISOString())

    calls._stopSoiler.length.should.eql(1)
    calls._soilPendingItems.length.should.eql(0)

    d = new Date(new Date().getTime() + 1000)
    proc._queueSoiler(d.toISOString())

    calls._stopSoiler.length.should.eql(1)
    calls._soilPendingItems.length.should.eql(0)

    d = new Date(new Date().getTime() + 50)
    proc._queueSoiler(d.toISOString())

    calls._stopSoiler.length.should.eql(2)
    calls._soilPendingItems.length.should.eql(0)

    this.clock.restore()
  })

  it('should soil only those items that are ready', async() => {
    this.clock = sandbox.useFakeTimers()

    let nowTime = new Date().getTime()
    let item1 = {
      doc: {
        _id: 'item1',
        dirty_at: (new Date(nowTime - 1)).toISOString()
      }
    }
    let item2 = {
      doc: {
        _id: 'item2',
        dirty_at: (new Date(nowTime - 100000)).toISOString()
      }
    }

    sandbox.stub(proc, '_dirtyAtItems').returns(testUtils.fakeIterator([
      item1, item2
    ]))
    let stub = sandbox.stub(proc, '_soilItemLogError')

    proc._soilPendingItems()

    stub.callCount.should.eql(2)
    stub.getCall(0).calledWith(item1)
    stub.getCall(1).calledWith(item2)

    this.clock.restore()
  })

  it('should requeue soiler if pending items remain', async() => {
    this.clock = sandbox.useFakeTimers()

    let nowTime = new Date().getTime()
    let item1 = {
      doc: {
        _id: 'item1',
        dirty_at: (new Date(nowTime - 1)).toISOString()
      }
    }
    let item2 = {
      doc: {
        _id: 'item2',
        dirty_at: (new Date(nowTime)).toISOString()
      }
    }
    let item3 = {
      doc: {
        _id: 'item3',
        dirty_at: (new Date(nowTime + 100)).toISOString()
      }
    }
    let item4 = {
      doc: {
        _id: 'item4',
        dirty_at: (new Date(nowTime + 1)).toISOString()
      }
    }
    let item5 = {
      doc: {
        _id: 'item5',
        dirty_at: (new Date(nowTime + 10)).toISOString()
      }
    }

    sandbox.stub(proc, '_dirtyAtItems').returns(testUtils.fakeIterator([
      item1, item2, item3, item4, item5
    ]))
    let soilStub = sandbox.stub(proc, '_soilItemLogError')
    let queueStub = sandbox.stub(proc, '_queueSoiler')

    await proc._soilPendingItems()

    queueStub.callCount.should.eql(1)
    queueStub.calledWith(1)

    soilStub.callCount.should.eql(2)
    soilStub.getCall(0).calledWith(item1)
    soilStub.getCall(1).calledWith(item2)

    this.clock.restore()
  })

  it('_soilItemLogError should handle error', async() => {
    // Fake conflict error
    proc._soilItem = sporks.promiseErrorFactory(conflictError)

    ignoreGlobalErrors()

    await proc._soilItemLogError()

    // Make sure _onError was called
    calls._onError[0][0].should.eql(conflictError)
  })

  it('should clear dirty_at and set dirty when soiling an item', async() => {
    let stub = sandbox.stub(proc, '_updateItem')

    await proc._soilItem({
      _id: 'item'
    })

    stub.called.should.eql(true)
    stub.getCall(0).args[0].should.eql({
      _id: 'item', dirty_at: null, dirty: true
    })
    stub.getCall(0).args[1].should.eql(true)
  })

  it('should run soiler', async() => {
    let dirtyAt = new Date().toISOString()
    let dbNames = testDBNames()

    await createItem({
      source: utils.couchDBURL() + '/' + dbNames[0],
      target: utils.couchDBURL() + '/' + dbNames[0],
      dirty_at: dirtyAt,
      dirty: false
    })

    await testUtils.createTestDBs(dbNames)

    await proc.start()

    await testUtils.waitFor(() => {
      return calls._queueSoiler.length === 1 ? true : undefined
    })

    calls._queueSoiler[0][0].should.eql(dirtyAt)

    await proc.stop()
  })

  it('_processAndUnlockIfError should set possibly_deleted_at on early DatabaseNotFoundError',
    () => {
      let theItem = { _id: 'foo' }

      sandbox.stub(proc, '_process').rejects(new DatabaseNotFoundError('fakeDb'))
      sandbox.stub(proc, '_isProbablyDeleted').returns(false)
      let upsertStub = sandbox.stub(proc, '_upsertUnlockPossiblyDeleted')

      return proc
        ._processAndUnlockIfError(theItem)
        .catch(err => {
          err.should.instanceOf(DatabaseNotFoundError)
        })
        .then(() => {
          sandbox.assert.calledWith(upsertStub, theItem)
        })
    })

  it('_processAndUnlockIfError should set just unlock on other errors', () => {
    let theItem = { _id: 'foo' }

    sandbox.stub(proc, '_process').rejects(new Error('Some other error'))
    let upsertStub = sandbox.stub(proc, '_upsertUnlock')

    return proc
      ._processAndUnlockIfError(theItem)
      .catch(err => {
        err.should.not.instanceOf(DatabaseNotFoundError)
      })
      .then(() => {
        sandbox.assert.calledWith(upsertStub, theItem)
      })
  })

  it('should set possibly_deleted_at in upsertUnlockPossiblyDeleted if not set', async() => {
    this.clock = sandbox.useFakeTimers()
    let theItem = { _id: 'foo' }

    this.clock.tick(500)
    let dateString = new Date().toISOString()

    let updateStub = sandbox.stub(proc, '_updateItem')

    await proc._upsertUnlockPossiblyDeleted(theItem)

    updateStub.callCount.should.eql(1)
    updateStub
      .calledWith({
        _id: 'foo',
        locked_at: null,
        possibly_deleted_at: dateString
      })
      .should.eql(true)

    theItem.possibly_deleted_at = dateString

    this.clock.tick(500)
    await proc._upsertUnlockPossiblyDeleted(theItem)

    updateStub.callCount.should.eql(2)
    updateStub
      .calledWith({
        _id: 'foo',
        locked_at: null
      })
      .should.eql(true)

    this.clock.restore()
  })

  it('should clear possibly_deleted_at in _unlockAndClean', async() => {
    sandbox.stub(proc, '_setClean')
    let stub = sandbox.stub(proc, '_updateItem')

    await proc._unlockAndClean({ _id: 'foo', possibly_deleted_at: new Date().toISOString() })

    stub.callCount.should.eql(1)
    stub.calledWith({ _id: 'foo', locked_at: null, possibly_deleted_at: null }).should.eql(true)
  })

  it('should clear possibly_deleted_at in _upsertUnlock', async() => {
    sandbox.stub(proc, '_setDirty')
    let stub = sandbox.stub(proc, '_updateItem')

    await proc._upsertUnlock({ _id: 'foo', possibly_deleted_at: new Date().toISOString() })

    stub.callCount.should.eql(1)
    stub.calledWith({ _id: 'foo', locked_at: null, possibly_deleted_at: null }).should.eql(true)
  })
})
