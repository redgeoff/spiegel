'use strict'

const ChangeListeners = require('../../src/change-listeners')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('change-listeners-bulk', () => {
  let listeners = null
  let docs = null
  let dirties = null

  const createListener = async listener => {
    listener._id = listeners._toId(listener.db_name)
    listener.type = 'listener'
    let doc = await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, listener)
    docs.push(doc)
  }

  const createListeners = async () => {
    docs = []

    // Clean & unlocked
    await createListener({
      db_name: 'test_db1'
    })

    // Dirty & unlocked
    await createListener({
      db_name: 'test_db2',
      dirty: true
    })

    // Clean & locked
    await createListener({
      db_name: 'test_db3',
      locked_at: new Date().toISOString()
    })

    // Dirty & locked
    await createListener({
      db_name: 'test_db4',
      dirty: true,
      locked_at: new Date().toISOString()
    })

    // Used to simulate race condition where listener is updated by another process
    await createListener({
      db_name: 'test_db5'
    })

    // Clean & unlocked
    await createListener({
      db_name: 'test_db6'
    })

    // Used to simulate race condition where listener is updated by another process
    await createListener({
      db_name: 'test_db7'
    })
  }

  const getListeners = async () => {
    let lists = []
    await Promise.all(
      docs.map(async (doc, i) => {
        lists[i] = await testUtils.spiegel._slouch.doc.get(testUtils.spiegel._dbName, doc.id)
      })
    )
    return lists
  }

  const spyOnDirty = () => {
    dirties = []
    listeners._dirtyOrCreate = function (listeners) {
      dirties.push(listeners)
      return ChangeListeners.prototype._dirtyOrCreate.apply(this, arguments)
    }
  }

  beforeEach(async () => {
    listeners = new ChangeListeners(testUtils.spiegel)
    spyOnDirty()
    await createListeners()
  })

  afterEach(async () => {
    await Promise.all(
      docs.map(async doc => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, doc.id)
      })
    )
  })

  // Simulate conflicts by updating the docs between the _getCleanOrLocked() and _dirty() calls
  const simulateConflicts = async () => {
    await testUtils.spiegel._slouch.doc.getMergeUpdate(testUtils.spiegel._dbName, {
      _id: docs[4].id,
      foo: 'test_db5' // ensure something is changed
    })

    await testUtils.spiegel._slouch.doc.getMergeUpdate(testUtils.spiegel._dbName, {
      _id: docs[6].id,
      foo: 'test_db7' // ensure something is changed
    })

    // Used to simulate race condition when a listener is created by another process after the get
    await createListener({
      db_name: 'test_db8'
    })
  }

  it('should dirty or create', async () => {
    let lists = await getListeners()
    testUtils.shouldEqual(lists[0].dirty, undefined)
    testUtils.shouldEqual(lists[2].dirty, undefined)

    let newListener = { db_name: 'test_db8' }

    await listeners._dirtyOrCreate([lists[0], lists[2], newListener])

    // Manually add DB name as it was created by _dirtyOrCreate() and not createListener()
    docs.push({ id: listeners._toId(newListener.db_name) })

    lists = await getListeners()

    // Checked the dirtied listeners
    lists[0].dirty.should.eql(true)
    lists[2].dirty.should.eql(true)

    // Check the new listener
    lists[7]._id.should.eql(listeners._toId(newListener.db_name))
    lists[7].db_name.should.eql('test_db8')
    lists[7].dirty.should.eql(true)
  })

  it('should get by DB names', async () => {
    let _docs = await listeners._getByDBNames([
      'test_db2',
      'test_db3',
      'test_db4',
      'test_db5',
      'test_db6',
      'test_db7',
      'test_db8'
    ])

    let dbNames = _docs.map(doc => doc.db_name)
    dbNames.should.eql(['test_db2', 'test_db3', 'test_db4', 'test_db5', 'test_db6', 'test_db7'])

    // Sanity test that we are getting locked_at and dirty
    testUtils.shouldNotEqual(_docs[2].locked_at, undefined)
    _docs[2].dirty.should.eql(true)
  })

  it('should clean, locked or missing listeners', async () => {
    let lists = await listeners._getCleanLockedOrMissing([
      'test_db0',
      'test_db1',
      'test_db2',
      'test_db4',
      'test_db5',
      'test_db6',
      'test_db7',
      'test_db8'
    ])

    let cleanOrLockedDBNames = []
    let missingDBNames = []

    sporks.each(lists, listener => {
      if (listener._id) {
        cleanOrLockedDBNames.push(listener.db_name)
      } else {
        missingDBNames.push(listener.db_name)
      }
    })

    // Check clean or locked listeners
    cleanOrLockedDBNames.should.eql(['test_db1', 'test_db4', 'test_db5', 'test_db6', 'test_db7'])

    // Check missing listeners
    missingDBNames.should.eql(['test_db0', 'test_db8'])
  })

  it('should dirty and get conflicted db names', async () => {
    let lists = await listeners._getCleanLockedOrMissing([
      'test_db1',
      'test_db2',
      'test_db4',
      'test_db5',
      'test_db6',
      'test_db7',
      'test_db8'
    ])

    await simulateConflicts()

    let conflictedDBNames = await listeners._dirtyAndGetConflictedDBNames(lists)
    conflictedDBNames.should.eql(['test_db5', 'test_db7', 'test_db8'])
  })

  // it('should dirty if clean or locked', async () => {
  //   // Simulate conflicts
  //   let simulated = false
  //   listeners._getCleanOrLocked = async function () {
  //     let lists = await Listeners.prototype._getCleanOrLocked.apply(this, arguments)
  //
  //     if (!simulated) {
  //       await simulateConflicts()
  //       simulated = true // only simulate once
  //     }
  //
  //     return lists
  //   }
  //
  //   await listeners.dirtyIfCleanOrLocked([
  //     'test_db1',
  //     'test_db2',
  //     'test_db4',
  //     'test_db5',
  //     'test_db6',
  //     'test_db7'
  //   ])
  //
  //   // 1st group of dirties
  //   let dbNames1 = dirties[0].map(doc => listeners._toDBName(doc.source))
  //   dbNames1.should.eql(['test_db1', 'test_db4', 'test_db5', 'test_db6', 'test_db7'])
  //
  //   // 2nd group of dirties as there were conflicts
  //   let dbNames2 = dirties[1].map(doc => listeners._toDBName(doc.source))
  //   dbNames2.should.eql(['test_db5', 'test_db7'])
  // })
  //
  // it('should dirty if clean or locked when nothing to dirty', async () => {
  //   await listeners.dirtyIfCleanOrLocked(['test_db2'])
  //   // test_db2 is already dirty so nothing should be dirtied
  //   dirties.should.eql([])
  // })
})
