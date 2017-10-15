'use strict'

const UpdateListeners = require('../../src/update-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('update-listeners', () => {
  let listeners = null
  let batches = null
  let updates = null
  let changeOpts = null
  let dirtyReplicators = null

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
    dirtyReplicators = []
    listeners._replicators = {
      dirtyIfCleanOrLocked: function (dbNames) {
        dirtyReplicators.push(dbNames)
      }
    }
  }

  const createTestDBs = async () => {
    await testUtils.createTestDBs(['test_db1', 'test_db2', 'test_db3'])
  }

  const createListeners = async opts => {
    listeners = new UpdateListeners(testUtils.spiegel, opts)
    spyOnProcessNextBatch()
    spyOnUpdates()
    spyOnChanges()
    spyOnDirtyReplicators()
    await listeners.start()
    await createTestDBs()
  }

  beforeEach(async () => {
    await testUtils.createSieve()
  })

  afterEach(async () => {
    await listeners.stop()
    await testUtils.destroySieve()
    await testUtils.destroyTestDBs()
  })

  it('should listen', async () => {
    await createListeners()

    await testUtils.waitFor(() => {
      return sporks.isEqual(batches, [
        {
          test_db1: true,
          test_db3: true
        }
      ])
        ? true
        : undefined
    })

    // Make sure we dirtied the correct replicators
    await testUtils.waitFor(() => {
      // We need to sort as the DBs can be in any order
      return sporks.isEqual(dirtyReplicators.sort(), [['test_db1', 'test_db3']]) ? true : undefined
    })

    // TODO: make sure we dirty the correct change listeners
  })

  it('batch should complete based on batchSize', async () => {
    await createListeners({ batchSize: 1 })

    // The first batch should only be for a single DB
    await testUtils
      .waitFor(() => {
        return sporks.isEqual(batches[0], {
          test_db1: true
        })
          ? true
          : undefined
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
    await testUtils._slouch.doc.create('test_db1', {
      foo: 'bar'
    })

    // All the initial updates should be in a batch and the next batch should contain the new update
    await testUtils.waitFor(() => {
      return sporks.isEqual(batches, [
        {
          test_db1: true,
          test_db3: true
        },
        {
          test_db1: true
        }
      ])
        ? true
        : undefined
    })
  })

  it('should resume at lastSeq', async () => {
    await createListeners({ batchSize: 1 })

    // Wait for a couple updates
    await testUtils.waitFor(() => {
      return updates.length === 2 ? true : undefined
    })

    // First call to changes should be missing a "since"
    testUtils.shouldEqual(changeOpts[0].since, undefined)

    // Second call should resume from lastSeq
    changeOpts[1].since.should.eql(updates[0].seq)
  })
})
