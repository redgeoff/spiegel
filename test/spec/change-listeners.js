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
    return listeners._get('test_db1')
  }

  it('should dirty when missing', async () => {
    let listener = await dirtyListener()
    listener._id.should.eql(listeners._idPrefix + 'test_db1')
    listener.db_name.should.eql('test_db1')
    listener.type.should.eql('change-listener')
    listener.dirty.should.eql(true)
  })

  it('should dirty when clean', async () => {
    // Create dirty listener
    let listener = await dirtyListener()

    // Clean listener
    let lastSeq = '123'
    await listeners._clean(listener, lastSeq)

    // Dirty the clean listener
    await listeners.dirtyIfClean('test_db1')

    // Make sure it is now dirty and the lastSeq was preserved
    listener = await listeners._get('test_db1')
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

  // it('should clean listener', async () => {})

  // TODO: variations on cleanOrUpdateLastSeq, including conflicts with dirty
})
