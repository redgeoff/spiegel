'use strict'

const UpdateListeners = require('../../src/update-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('update-listeners', () => {
  let listeners = null
  let batches = null
  let updates = null
  let changeOpts = null

  const spyOnProcessNextBatch = () => {
    batches = []
    listeners._processNextBatch = function () {
      batches.push(this._updatedDBs)
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

  const createTestDBs = async () => {
    await testUtils.createTestDBs(['test_db1', 'test_db2', 'test_db3'])
  }

  const createListeners = async opts => {
    listeners = new UpdateListeners(testUtils.spiegel, opts)
    spyOnProcessNextBatch()
    spyOnUpdates()
    spyOnChanges()
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

    await sporks.waitFor(() => {
      return sporks.isEqual(batches, [
        {
          test_db1: true,
          test_db3: true
        }
      ])
    })
  })

  it('batch should complete based on batchSize', async () => {
    await createListeners({ batchSize: 1 })

    // The first batch should only be for a single DB
    await sporks.waitFor(() => {
      return sporks.isEqual(batches[0], {
        test_db1: true
      })
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
    await sporks.waitFor(() => {
      return sporks.isEqual(batches, [
        {
          test_db1: true,
          test_db3: true
        },
        {
          test_db1: true
        }
      ])
    })
  })

  it('should resume at lastSeq', async () => {
    await createListeners({ batchSize: 1 })

    // Wait for a couple updates
    await sporks.waitFor(() => {
      return updates.length === 2 ? true : undefined
    })

    // First call to changes should be missing a "since"
    testUtils.shouldEqual(changeOpts[0].since, undefined)

    // Second call should resume from lastSeq
    changeOpts[1].since.should.eql(updates[0].seq)
  })
})
