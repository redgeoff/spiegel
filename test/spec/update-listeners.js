'use strict'

const UpdateListeners = require('../../src/update-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')
// const Globals = require('../../src/globals')

describe('update-listeners', () => {
  let listeners = null
  let batches = null
  let updates = null
  let changeOpts = null
  let dirtyReplicators = null
  let dirtyChangeListeners = null
  // let lastSeq
  let suffixId = 0
  let suffix = null

  // Specify a large batchTimeout so that time is not a factor
  const BATCH_TIMEOUT = 5000

  const spyOnProcessNextBatch = () => {
    batches = []
    listeners._processNextBatch = function () {
      batches.push(this._updatedDBs)
      return UpdateListeners.prototype._processNextBatch.apply(this, arguments)
    }
  }

  const spyOnUpdates = () => {
    updates = []
    listeners._addToUpdatedDBs = function (update) {
      updates.push(update)
      return UpdateListeners.prototype._addToUpdatedDBs.apply(this, arguments)
    }
  }

  const spyOnChanges = () => {
    changeOpts = []
    listeners._changes = function (opts) {
      changeOpts.push(opts)
      return UpdateListeners.prototype._changes.apply(this, arguments)
    }
  }

  const spyOnDirtyReplicators = () => {
    dirtyReplicators = {}
    listeners._replicators = {
      dirtyIfCleanOrLocked: function (dbNames) {
        dbNames.forEach(dbName => {
          dirtyReplicators[dbName] = true
        })
      }
    }
  }

  const spyOnDirtyChangeListeners = () => {
    dirtyChangeListeners = {}
    listeners._changeListeners = {
      dirtyIfCleanOrLocked: function (dbNames) {
        dbNames.forEach(dbName => {
          dirtyChangeListeners[dbName] = true
        })
      }
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

  const createTestDBs = async () => {
    await testUtils.createTestDBs(['test_db1' + suffix, 'test_db2' + suffix, 'test_db3' + suffix])
  }

  const createListeners = async (opts, fakeLastSeq = true) => {
    listeners = new UpdateListeners(testUtils.spiegel, opts)
    spyOnProcessNextBatch()
    spyOnUpdates()
    spyOnChanges()
    spyOnDirtyReplicators()
    spyOnDirtyChangeListeners()
    if (fakeLastSeq) {
      // fakeGlobals()
    }
    // await getLastSeq()
    await listeners.start()
    await createTestDBs()
  }

  beforeEach(async () => {
    // We need to define a suffix to append to the DB names so that they are unique across tests or
    // else CouchDB will sometimes give us unexpected results in the _global_changes DB
    suffixId++
    suffix = '_' + suffixId
    await testUtils.createSieve(suffix)
  })

  afterEach(async () => {
    await listeners.stop()
    await testUtils.destroySieve()
    await testUtils.destroyTestDBs()
  })

  it('should listen', async () => {
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
      .catch(function (err) {
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
      .catch(function (err) {
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
      .catch(function (err) {
        console.log('dirtyChangeListeners=', dirtyChangeListeners)
        throw err
      })
  })

  it('batch should complete based on batchSize', async () => {
    await createListeners({ batchSize: 1, batchTimeout: BATCH_TIMEOUT })

    // The first batch should only be for a single DB
    await testUtils
      .waitFor(() => {
        return sporks.length(batches[0]) === 1 ? true : undefined
      })
      .catch(function (err) {
        console.log('batches[0]=', batches[0])
        throw err
      })
  })

  it('batch should complete based on batchTimeout', async () => {
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
      .catch(function (err) {
        console.log('batches=', batches)
        throw err
      })
  })

  it('should resume at lastSeq', async () => {
    await createListeners({ batchSize: 1, batchTimeout: BATCH_TIMEOUT }, false)

    // Wait for a couple updates
    await testUtils
      .waitFor(() => {
        return updates.length >= 2 ? true : undefined
      })
      .catch(function (err) {
        console.log('updates=', updates)
        throw err
      })

    // First call to changes should be missing a "since"
    testUtils.shouldEqual(changeOpts[0].since, undefined)

    // Second call should resume from lastSeq
    changeOpts[1].since.should.eql(updates[0].seq)
  })
})
