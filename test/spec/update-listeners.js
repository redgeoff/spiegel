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

  beforeEach(async () => {
    listeners = new UpdateListeners(testUtils.spiegel)
    await testUtils.createSieve()
    spyOnProcessNextBatch()
    await listeners.start()
    await testUtils.createTestDBs(['test_db1', 'test_db2', 'test_db3'])
  })

  afterEach(async () => {
    await listeners.stop()
    await testUtils.destroySieve()
    await testUtils.destroyTestDBs()
  })

  it('should listen', async () => {
    var expBatches = [
      {
        test_db1: true,
        test_db3: true
      }
    ]

    await sporks.waitFor(() => {
      if (sporks.isEqual(batches, expBatches)) {
        return true
      }
    })
  })

  // TODO: make sure batch expires based on batchSize
  // TODO: make sure batch expires based on batchTimeout
  // TODO: check next batch and make sure resumes at lastSeq
})
