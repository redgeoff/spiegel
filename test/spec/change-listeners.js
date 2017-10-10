'use strict'

const ChangeListeners = require('../../src/change-listeners')
const testUtils = require('../utils')

describe('change-listeners', () => {
  let listeners = null
  let listenerIds = []

  beforeEach(async () => {
    listeners = new ChangeListeners(testUtils.spiegel)
  })

  afterEach(async () => {
    await Promise.all(
      listenerIds.map(async id => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, id)
      })
    )
  })

  it('should dirty when missing', async () => {
    await listeners.dirtyIfClean('test_db1')
    listenerIds.push(listeners._toId('test_db1'))

    let listener = await listeners._get('test_db1')
    listener._id.should.eql(listeners._idPrefix + 'test_db1')
    listener.db_name.should.eql('test_db1')
    listener.type.should.eql('change-listener')
    listener.dirty.should.eql(true)
  })
})
