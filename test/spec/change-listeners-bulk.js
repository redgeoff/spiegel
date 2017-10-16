'use strict'

const ChangeListeners = require('../../src/change-listeners')
const testUtils = require('../utils')

describe('change-listeners-bulk', () => {
  let listeners = null
  let docs = null
  let dirties = null

  const createListener = async listener => {
    listener.type = 'listener'
    let doc = await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, listener)
    docs.push(doc)
  }

  const createListeners = async () => {
    docs = []

    // Clean & unlocked
    await createListener({
      _id: '1',
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

  // const getListeners = async () => {
  //   let reps = []
  //   await Promise.all(
  //     docs.map(async (doc, i) => {
  //       reps[i] = await testUtils.spiegel._slouch.doc.get(testUtils.spiegel._dbName, doc.id)
  //     })
  //   )
  //   return reps
  // }

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

  // // Simulate conflicts by updating the docs between the _getCleanOrLocked() and _dirty() calls
  // const simulateConflicts = async () => {
  //   await testUtils.spiegel._slouch.doc.getMergeUpdate(testUtils.spiegel._dbName, {
  //     _id: docs[4].id,
  //     foo: 'test_db5' // ensure something is changed
  //   })
  //
  //   await testUtils.spiegel._slouch.doc.getMergeUpdate(testUtils.spiegel._dbName, {
  //     _id: docs[6].id,
  //     foo: 'test_db7' // ensure something is changed
  //   })
  // }

  // it('should dirty', async () => {
  //   let reps = await getReplicators()
  //   testUtils.shouldEqual(reps[0].dirty, undefined)
  //   testUtils.shouldEqual(reps[2].dirty, undefined)
  //
  //   await listeners._dirty([reps[0], reps[2]])
  //
  //   reps = await getReplicators()
  //   reps[0].dirty.should.eql(true)
  //   reps[2].dirty.should.eql(true)
  // })

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

  // it('should dirty and get conflicted db names', async () => {
  //   let reps = await listeners._getCleanOrLocked([
  //     'test_db1',
  //     'test_db2',
  //     'test_db4',
  //     'test_db5',
  //     'test_db6',
  //     'test_db7'
  //   ])
  //
  //   await simulateConflicts()
  //
  //   let conflictedDBNames = await listeners._dirtyAndGetConflictedDBNames(reps)
  //   conflictedDBNames.should.eql(['test_db5', 'test_db7'])
  // })
  //
  // it('should dirty if clean or locked', async () => {
  //   // Simulate conflicts
  //   let simulated = false
  //   listeners._getCleanOrLocked = async function () {
  //     let reps = await Replicators.prototype._getCleanOrLocked.apply(this, arguments)
  //
  //     if (!simulated) {
  //       await simulateConflicts()
  //       simulated = true // only simulate once
  //     }
  //
  //     return reps
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
