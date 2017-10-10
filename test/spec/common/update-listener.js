'use strict'

const UpdateListener = require('../../../src/common/update-listener')
const testUtils = require('../../utils')
const sporks = require('sporks')

describe('update-listener', () => {
  let listener = null
  let updates = []

  const spyOnUpdates = () => {
    listener._onUpdate = update => {
      updates[update.id] = true
    }
  }

  beforeEach(async () => {
    listener = new UpdateListener(testUtils.spiegel)
    await testUtils.createSieve()
    spyOnUpdates()
    await listener.start()
    await testUtils.createTestDBs(['test_db1', 'test_db2', 'test_db3'])
  })

  afterEach(async () => {
    await listener.stop()
    await testUtils.destroySieve()
    await testUtils.destroyTestDBs()
  })

  it('should listen', async () => {
    var expUpdates = {
      'created:test_db1': true,
      'updated:test_db1': true,
      'deleted:test_db1': true,
      'created:test_db3': true,
      'updated:test_db3': true,
      'deleted:test_db3': true
    }

    await sporks.waitFor(() => {
      if (sporks.isEqual(updates, expUpdates)) {
        return true
      }
    })
  })
})
