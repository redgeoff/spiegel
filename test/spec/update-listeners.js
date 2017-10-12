'use strict'

const UpdateListeners = require('../../src/update-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('update-listeners', () => {
  let listeners = null
  let batches = null

  const spyOnProcessNextBatch = () => {
    batches = []
    listeners._processNextBatch = function () {
      batches.push(this._updatedDBs)
    }
  }

  const createTestDBs = async () => {
    await testUtils.createTestDBs(['test_db1', 'test_db2', 'test_db3'])
  }

  const createListeners = async opts => {
    listeners = new UpdateListeners(testUtils.spiegel, opts)
    spyOnProcessNextBatch()
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

  // TODO: check next batch and make sure resumes at lastSeq
})
