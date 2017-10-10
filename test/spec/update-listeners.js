'use strict'

const UpdateListeners = require('../../src/update-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('update-listeners', () => {
  let listeners = null
  let updates = []

  const spyOnUpdates = () => {
    listeners._onUpdate = update => {
      updates[update.id] = true
    }
  }

  beforeEach(async () => {
    listeners = new UpdateListeners(testUtils.spiegel)
    await testUtils.createSieve()
    spyOnUpdates()
    await listeners.start()
    await testUtils.createTestDBs(['test_db1', 'test_db2', 'test_db3'])
  })

  afterEach(async () => {
    await listeners.stop()
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
