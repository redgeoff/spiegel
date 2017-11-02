'use strict'

const Process = require('../../src/process')
const testUtils = require('../utils')
const sporks = require('sporks')
const utils = require('../../src/utils')
const EventEmitter = require('events').EventEmitter

describe('process', () => {
  let globalProc = null
  let proc = null
  let itemIds = null
  let calls = null
  let globalError = false
  let retryAfterSeconds = 1
  let checkStalledSeconds = 1
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
        '_onError'
      ],
      calls
    )
  }

  const listenForErrors = () => {
    proc.once('err', function (err) {
      globalError = err
    })
  }

  const ignoreGlobalErrors = () => {
    // Fake emitting of error so that we don't actually emit an error
    proc.emit = () => {}
  }

  before(async () => {
    globalProc = new Process(testUtils.spiegel, { retryAfterSeconds, checkStalledSeconds }, type)
    await globalProc._createViews()
  })

  after(async () => {
    await globalProc._destroyViews()
  })

  beforeEach(async () => {
    proc = new Process(testUtils.spiegel, { retryAfterSeconds, checkStalledSeconds }, type)
    itemIds = []
    spy()
    listenForErrors()
  })

  // TODO: move to slouch
  const downsert = (dbName, id) => {
    return testUtils.spiegel._slouch.doc._persistThroughConflicts(function () {
      return testUtils.spiegel._slouch.doc.getAndDestroy(dbName, id)
    })
  }

  afterEach(async () => {
    await Promise.all(
      itemIds.map(async id => {
        // We need to use a downsert as we need to handle race conditions caused when we have
        // multiple nodes
        await downsert(testUtils.spiegel._dbName, id)
      })
    )
    await testUtils.destroyTestDBs()

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

  const createTestItem = async () => {
    let rep = await createItem({
      source: 'https://example.com/test_db1'
    })
    return proc._get(rep._id)
  }

  const fakeSuccessfulProcessing = () => {
    proc._process = sporks.resolveFactory()
  }

  it('should lock item', async () => {
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

  it('lock should throw when conflict', async () => {
    await shouldThrowWhenConflict('_lock')
  })

  it('unlock should throw when conflict', async () => {
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

  it('should upsert unlock', async () => {
    await shouldUpsertUnlock()
  })

  it('should upsert unlock when conflict', async () => {
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

  it('should unlock and clean', async () => {
    await shouldUnlockAndClean()
  })

  it('should not unlock and clean when conflict', async () => {
    await shouldUnlockAndClean(true)
  })

  it('_lockProcessUnlock should handle non-conflict error when locking', async () => {
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

  it('_lockProcessUnlock should handle conflict when locking', async () => {
    let item = await createTestItem()

    // Fake conflict error
    proc._lock = sporks.promiseErrorFactory(conflictError)

    await proc._lockProcessUnlock(item)

    // Make sure other calls are then skipped
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._processAndUnlockIfError.length.should.eql(0)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockProcessUnlock should handle error when processing', async () => {
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

  it('_lockProcessUnlock should handle non-conflict error when cleaning', async () => {
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

  it('_lockProcessUnlock should handle conflict error when cleaning', async () => {
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

  it('should _lockProcessUnlock without errors', async () => {
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

  it('should start when proc already dirty', async () => {
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

  it('should start with no proc dirty', async () => {
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

  it('should unstall', async () => {
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

  it('_setDirty should not clean when leaveDirty', () => {
    let item = { dirty: true }
    proc._setDirty(item, true)
    item.should.eql({ dirty: true })
  })

  it('_lockProcessUnlockLogError should handle error', async () => {
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

    // Make sure _onError was called
    calls._onError[0][0].should.eql(conflictError)
  })

  it('should stop when not already started', async () => {
    await proc.stop()
  })

  it('_unlockAndThrowIfNotConflict should throw if not conflict', async () => {
    // Fake non-conflict error
    proc._unlock = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return proc._unlockAndThrowIfNotConflict()
    }, nonConflictError)
  })

  it('_unlockAndThrowIfNotConflict should not throw if conflict', async () => {
    // Fake non-conflict error
    proc._unlock = sporks.promiseErrorFactory(conflictError)

    await proc._unlockAndThrowIfNotConflict()
  })

  it('_unlockStalledLogError should log errors', async () => {
    // Fake conflict error
    proc._unlockStalled = sporks.promiseErrorFactory(conflictError)

    ignoreGlobalErrors()

    await proc._unlockStalledLogError()

    // Make sure _onError was called
    calls._onError[0][0].should.eql(conflictError)
  })
})
