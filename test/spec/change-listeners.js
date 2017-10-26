'use strict'

const ChangeListeners = require('../../src/change-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('change-listeners', () => {
  let listeners = null
  let listenerIds = null
  let upserts = null

  const spy = () => {
    listeners._upsert = function (listener) {
      upserts.push(listener)
      return ChangeListeners.prototype._upsert.apply(this, arguments)
    }
  }

  beforeEach(async () => {
    listeners = new ChangeListeners(testUtils.spiegel)
    listenerIds = []
    upserts = []
    spy()
  })

  afterEach(async () => {
    let ids = sporks.keys(listenerIds)
    await Promise.all(
      ids.map(async id => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, id)
      })
    )
  })

  const dirtyListener = async () => {
    await listeners.dirtyIfClean('test_db1')
    listenerIds[listeners._toId('test_db1')] = true
    return listeners._getByDBName('test_db1')
  }

  it('should dirty when missing', async () => {
    let listener = await dirtyListener()
    listener._id.should.eql(listeners._idPrefix + 'test_db1')
    listener.db_name.should.eql('test_db1')
    listener.type.should.eql('change_listener')
    listener.dirty.should.eql(true)
  })

  it('should dirty when clean', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Clean listener
    let lastSeq = '123'
    await listeners._cleanAndUnlock(listener, lastSeq)

    // Dirty the clean listener
    await listeners.dirtyIfClean('test_db1')

    // Make sure it is now dirty and the lastSeq was preserved
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(true)
    listener.last_seq.should.eql(lastSeq)
  })

  it('should do nothing when already dirty', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Make sure upsert was called
    upserts.length.should.eql(1)

    // Attempt to dirty listener
    listener = await dirtyListener()

    // Make sure listener is still dirty
    listener.dirty.should.eql(true)

    // Make sure upsert was not called again
    upserts.length.should.eql(1)
  })

  it('lock listener', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Lock listener
    let lockedListener = await listeners.lock(listener)

    // Get the saved listener and compare
    let savedListener = await listeners._getByDBName('test_db1')
    savedListener.should.eql(lockedListener)

    // The rev should have changed
    lockedListener._rev.should.not.eql(listener._rev)

    // The locked_at value should have been populated
    lockedListener.locked_at.should.not.eql(undefined)

    // The updated_at value should have been populated
    lockedListener.updated_at.should.not.eql(undefined)
  })

  it('lock should throw when conflict', async () => {
    // Create listener
    let listener = await dirtyListener()

    // Modify listener to simulate a conflict later
    listener.dirty = true
    await testUtils.spiegel._slouch.doc.update(testUtils.spiegel._dbName, listener)

    let savedListener1 = await listeners._getByDBName(listener.db_name)

    let err = null
    try {
      // Lock listener
      await listeners.lock(listener)
    } catch (_err) {
      err = _err
    }
    testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)

    // Get the saved listener and make sure nothing changed
    let savedListener2 = await listeners._getByDBName(listener.db_name)
    savedListener2.should.eql(savedListener1)
  })

  it('should clean and unlock listener', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Lock listener
    listener = await listeners.lock(listener)

    // Clean listener
    let lastSeq = '123'
    await listeners._cleanAndUnlock(listener, lastSeq)

    // Make sure it is now clean and the lastSeq was set
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(false)
    listener.last_seq.should.eql(lastSeq)
    testUtils.shouldEqual(listener.locked_at, undefined)
  })

  it('cleanAndUnlockOrUpdateLastSeq should clean and unlock', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Clean listener
    let lastSeq = '123'
    await listeners.cleanAndUnlockOrUpdateLastSeq(listener, lastSeq)

    // Make sure it is now clean and the lastSeq was set
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(false)
    listener.last_seq.should.eql(lastSeq)
  })

  it('cleanAndUnlockOrUpdateLastSeq should update', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Update the lastSeq to prepare for the conflict
    await listeners._updateLastSeq(listener._id, '123')

    // Attempt to clean, but actually set last seq
    let lastSeq = '222'
    await listeners.cleanAndUnlockOrUpdateLastSeq(listener, lastSeq)

    // Make sure it is still dirty, but the lastSeq was updated
    listener = await listeners._getByDBName('test_db1')
    listener.dirty.should.eql(true)
    listener.last_seq.should.eql(lastSeq)
  })
})
