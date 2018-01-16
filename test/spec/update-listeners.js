'use strict'

const UpdateListeners = require('../../src/update-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')
// const Globals = require('../../src/globals')
const EventEmitter = require('events').EventEmitter
const sinon = require('sinon')

describe('update-listeners', () => {
  let listeners = null
  let batches = null
  let updates = null
  let changeOpts = null
  let dirtyReplicators = null
  let dirtyChangeListeners = null
  let globals = null
  // let lastSeq
  let suffix = null
  let calls = null

  // Specify a large batchTimeout so that time is not a factor
  const BATCH_TIMEOUT = 5000

  const spy = () => {
    calls = []
    testUtils.spy(
      listeners,
      ['_logFatal', '_onError', '_changeListenersDirtyIfCleanOrLocked'],
      calls
    )
  }

  const spyOnProcessUpdatedDBs = () => {
    batches = []
    listeners._processUpdatedDBs = function() {
      batches.push(this._updatedDBs)
      return UpdateListeners.prototype._processUpdatedDBs.apply(this, arguments)
    }
  }

  const spyOnUpdates = () => {
    updates = []
    listeners._addToUpdatedDBs = function(update) {
      updates.push(update)
      return UpdateListeners.prototype._addToUpdatedDBs.apply(this, arguments)
    }
  }

  const spyOnChanges = () => {
    changeOpts = []
    listeners._changes = function(opts) {
      changeOpts.push(opts)
      return UpdateListeners.prototype._changes.apply(this, arguments)
    }
  }

  const spyOnDirtyReplicators = () => {
    dirtyReplicators = {}
    listeners._replicatorsDirtyIfCleanOrLocked = function(dbNames) {
      dbNames.forEach(dbName => {
        dirtyReplicators[dbName] = true
      })
    }
  }

  const spyOnDirtyChangeListeners = () => {
    dirtyChangeListeners = {}
    listeners._changeListenersDirtyIfCleanOrLocked = function(dbNames) {
      dbNames.forEach(dbName => {
        dirtyChangeListeners[dbName] = true
      })
    }
  }

  const spyOnSetGlobal = () => {
    globals = []
    listeners._setGlobal = function(name, value) {
      globals.push({ name, value })
      return UpdateListeners.prototype._setGlobal.apply(this, arguments)
    }
  }

  // const fakeGlobals = async () => {
  //   listeners._globals.get = function (name) {
  //     if (name === 'lastSeq') {
  //       return Promise.resolve(lastSeq)
  //     } else {
  //       return Globals.prototype.get.apply(this, arguments)
  //     }
  //   }
  // }

  // // Get the lastSeq as changes in _global_changes and run over from test to test and we want to
  // // minimize the noise
  // const getLastSeq = async () => {
  //   await testUtils.spiegel._slouch.db
  //     .changes(testUtils.spiegel._dbName, {
  //       limit: 1,
  //       descending: true
  //     })
  //     .each(change => {
  //       lastSeq = change.seq
  //     })
  // }

  const createTestDBs = async() => {
    await testUtils.createTestDBs(['test_db1' + suffix, 'test_db3' + suffix])
  }

  const fakeOnChanges = async() => {
    listeners._matchWithDBNames = function(dbNames) {
      return Promise.resolve(dbNames)
    }
  }

  const createListeners = async(
    opts,
    fakeLastSeq = true,
    fakeOnChange = true,
    clearSeq = false,
    start = true
  ) => {
    listeners = new UpdateListeners(testUtils.spiegel, opts)

    if (clearSeq) {
      // We need to explicitly clear the lastSeq as the lastSeq is automatically updated when the
      // UpdateListener is stopped
      await clearLastSeq()
    }

    spyOnProcessUpdatedDBs()
    spyOnUpdates()
    spyOnChanges()
    spyOnDirtyReplicators()
    spyOnDirtyChangeListeners()
    spyOnSetGlobal()
    spy()
    if (fakeLastSeq) {
      // fakeGlobals()
    }
    // await getLastSeq()
    if (fakeOnChange) {
      fakeOnChanges()
    }
    if (start) {
      await listeners.start()
    }
    await createTestDBs()
  }

  const clearLastSeq = async() => {
    await listeners._setGlobal('lastSeq', null)
  }

  before(async() => {
    // Destroy default sieve as we want a custom sieve so that our tests can filter out changes to
    // _global_changes that are from other tests
    let lists = new UpdateListeners(testUtils.spiegel)
    await lists._destroySieve()
  })

  after(async() => {
    // Restore default sieve
    let lists = new UpdateListeners(testUtils.spiegel)
    await lists._createSieve()
  })

  beforeEach(async() => {
    suffix = testUtils.nextSuffix()
    await testUtils.createSieve(suffix)
  })

  afterEach(async() => {
    await listeners.stop()
    await testUtils.destroySieve()
    await testUtils.destroyTestDBs()
  })

  it('should listen', async() => {
    await createListeners()

    await testUtils
      .waitFor(() => {
        return sporks.isEqual(batches, [
          {
            ['test_db1' + suffix]: true,
            ['test_db3' + suffix]: true
          }
        ])
          ? true
          : undefined
      })
      .catch(function(err) {
        console.log('batches=', batches)
        throw err
      })

    // Make sure we dirtied the correct replicators
    await testUtils
      .waitFor(() => {
        return sporks.isEqual(dirtyReplicators, {
          ['test_db1' + suffix]: true,
          ['test_db3' + suffix]: true
        })
          ? true
          : undefined
      })
      .catch(function(err) {
        console.log('dirtyReplicators=', dirtyReplicators)
        throw err
      })

    // Make sure we dirtied the correct ChangeListeners
    await testUtils
      .waitFor(() => {
        return sporks.isEqual(dirtyChangeListeners, {
          ['test_db1' + suffix]: true,
          ['test_db3' + suffix]: true
        })
          ? true
          : undefined
      })
      .catch(function(err) {
        console.log('dirtyChangeListeners=', dirtyChangeListeners)
        throw err
      })
  })

  it('batch should complete based on batchSize', async() => {
    await createListeners({ batchSize: 1, batchTimeout: BATCH_TIMEOUT })

    // The first batch should only be for a single DB
    await testUtils
      .waitFor(() => {
        return sporks.length(batches[0]) === 1 ? true : undefined
      })
      .catch(function(err) {
        console.log('batches[0]=', batches[0])
        throw err
      })
  })

  it('batch should complete based on batchTimeout', async() => {
    await createListeners({ batchSize: 1000, batchTimeout: 1000 })

    // Wait until after the timeout expires, but the batch size has not been reached
    await sporks.timeout(2000)

    // Create a new update
    await testUtils._slouch.doc.create('test_db1' + suffix, {
      foo: 'bar'
    })

    // All the initial updates should be in a batch and the next batch should contain the new update
    await testUtils
      .waitFor(() => {
        return sporks.isEqual(batches, [
          {
            ['test_db1' + suffix]: true,
            ['test_db3' + suffix]: true
          },
          {
            ['test_db1' + suffix]: true
          }
        ])
          ? true
          : undefined
      })
      .catch(function(err) {
        console.log('batches=', batches)
        throw err
      })
  })

  it('should resume at lastSeq', async() => {
    await createListeners({ batchSize: 1, batchTimeout: BATCH_TIMEOUT }, false, true, true)

    // Wait for a couple updates
    await testUtils
      .waitFor(() => {
        return updates.length >= 2 ? true : undefined
      })
      .catch(function(err) {
        console.log('updates=', updates)
        throw err
      })

    // First call to changes should be missing a "since"
    testUtils.shouldEqual(changeOpts[0].since, undefined)

    // Stop the listeners and then start again to make sure that we resume from the lastSeq
    await listeners.stop()
    changeOpts = []
    await listeners.start()

    // Second call should resume from lastSeq
    changeOpts[0].since.should.eql(updates[updates.length - 1].seq)
  })

  it('should _matchAndDirtyFiltered', async() => {
    await createListeners()

    // Fake filtering
    listeners._matchWithDBNames = function() {
      return Promise.resolve(['test_db1'])
    }

    await listeners._matchAndDirtyFiltered(['test_db1', 'test_db2'])

    dirtyChangeListeners.should.eql({
      test_db1: true
    })
  })

  it('should save lastSeq', async() => {
    await createListeners(
      { batchSize: 1, batchTimeout: BATCH_TIMEOUT, saveSeqAfterSeconds: 0 },
      false
    )

    // Wait for a couple updates
    await testUtils
      .waitFor(() => {
        return updates.length >= 2 ? true : undefined
      })
      .catch(function(err) {
        console.log('updates=', updates)
        throw err
      })

    // Make sure that lastSeq was saved for the first update
    globals[0].should.eql({ name: 'lastSeq', value: updates[0].seq })
  })

  it('should log fatal errors when listening', async() => {
    await createListeners()

    // Fake error
    let err = new Error()
    listeners._listenToUpdates = sporks.promiseErrorFactory(err)

    await listeners._listen()

    calls._logFatal[0][0].should.eql(err)
  })

  it('should _listenToIteratorErrors', async() => {
    await createListeners()

    let emitter = new EventEmitter()

    listeners._listenToIteratorErrors(emitter)

    // Fake error
    let err = new Error()
    emitter.emit('error', err)

    // Make sure _onError was called
    calls._onError[0][0].should.eql(err)
  })

  it('should stop when not already started', async() => {
    let listeners2 = new UpdateListeners(testUtils.spiegel)
    await listeners2.stop()
  })

  it('_matchAndDirtyFiltered should handle no filteredDBNames', async() => {
    await createListeners()

    // Fake no DBs
    listeners._matchWithDBNames = sporks.resolveFactory([])

    await listeners._matchAndDirtyFiltered()

    calls._changeListenersDirtyIfCleanOrLocked.length.should.eql(0)
  })

  it('should synchronize when processing batch', async() => {
    await createListeners()

    sinon.spy(listeners._synchronizer, 'run')

    await listeners._processBatch()

    listeners._synchronizer.run.calledOnce.should.eql(true)
  })

  it('should synchronize on update', async() => {
    // Don't automatically start as we don't want to interfer with the desired calledOnce
    let start = false

    await createListeners(null, true, true, false, start)

    sinon.spy(listeners._synchronizer, 'run')

    await listeners._onUpdate({ id: 'update:db1' })

    listeners._synchronizer.run.calledOnce.should.eql(true)
  })
})
