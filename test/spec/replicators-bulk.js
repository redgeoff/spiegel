'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('replicators-bulk', () => {
  let replicators = null
  let docs = null
  let dirties = null

  const createReplicator = async replicator => {
    replicator.type = 'replicator'
    let doc = await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, replicator)
    docs.push(doc)
  }

  const createReplicators = async () => {
    docs = []

    // Clean & unlocked
    await createReplicator({
      _id: '1',
      source: 'https://example.com/test_db1'
    })

    // Dirty & unlocked
    await createReplicator({
      source: 'https://example.com/test_db2',
      dirty: true
    })

    // Clean & locked
    await createReplicator({
      source: 'https://example.com/test_db3',
      locked_at: new Date().toISOString()
    })

    // Dirty & locked
    await createReplicator({
      source: 'https://example.com/test_db4',
      dirty: true,
      locked_at: new Date().toISOString()
    })

    // Used to simulate race condition where replicator is updated by another process
    await createReplicator({
      source: 'https://example.com/test_db5'
    })

    // Clean & unlocked
    await createReplicator({
      source: 'https://example.com/test_db6'
    })

    // Used to simulate race condition where replicator is updated by another process
    await createReplicator({
      source: 'https://example.com/test_db7'
    })
  }

  const getReplicators = async () => {
    let reps = []
    await Promise.all(
      docs.map(async (doc, i) => {
        reps[i] = await testUtils.spiegel._slouch.doc.get(testUtils.spiegel._dbName, doc.id)
      })
    )
    return reps
  }

  const spyOnDirty = () => {
    dirties = []
    replicators._dirty = function (replicators) {
      dirties.push(replicators)
      return Replicators.prototype._dirty.apply(this, arguments)
    }
  }

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel)
    spyOnDirty()
    await createReplicators()
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
  }

  it('should dirty', async () => {
    let reps = await getReplicators()
    testUtils.shouldEqual(reps[0].dirty, undefined)
    testUtils.shouldEqual(reps[2].dirty, undefined)

    let rep0 = sporks.clone(reps[0])
    let rep2 = sporks.clone(reps[2])

    await replicators._dirty([rep0, rep2])

    let updatedReps = await getReplicators()
    updatedReps[0].dirty.should.eql(true)
    updatedReps[0].updated_at.should.not.eql(reps[0].updated_at)
    updatedReps[2].dirty.should.eql(true)
    updatedReps[0].updated_at.should.not.eql(reps[0].updated_at)
  })

  it('should get clean or locked', async () => {
    let docs = await replicators._getCleanOrLocked([
      'test_db2',
      'test_db3',
      'test_db4',
      'test_db5',
      'test_db6',
      'test_db7'
    ])

    let dbNames = docs.map(doc => replicators._toDBName(doc.source))
    dbNames.should.eql(['test_db3', 'test_db4', 'test_db5', 'test_db6', 'test_db7'])
  })

  it('should dirty and get conflicted db names', async () => {
    let reps = await replicators._getCleanOrLocked([
      'test_db1',
      'test_db2',
      'test_db4',
      'test_db5',
      'test_db6',
      'test_db7'
    ])

    await simulateConflicts()

    let conflictedDBNames = await replicators._dirtyAndGetConflictedDBNames(reps)
    conflictedDBNames.should.eql(['test_db5', 'test_db7'])
  })

  it('should dirty if clean or locked', async () => {
    // Simulate conflicts
    let simulated = false
    replicators._getCleanOrLocked = async function () {
      let reps = await Replicators.prototype._getCleanOrLocked.apply(this, arguments)

      if (!simulated) {
        await simulateConflicts()
        simulated = true // only simulate once
      }

      return reps
    }

    await replicators.dirtyIfCleanOrLocked([
      'test_db1',
      'test_db2',
      'test_db4',
      'test_db5',
      'test_db6',
      'test_db7'
    ])

    // 1st group of dirties
    let dbNames1 = dirties[0].map(doc => replicators._toDBName(doc.source))
    dbNames1.should.eql(['test_db1', 'test_db4', 'test_db5', 'test_db6', 'test_db7'])

    // 2nd group of dirties as there were conflicts
    let dbNames2 = dirties[1].map(doc => replicators._toDBName(doc.source))
    dbNames2.should.eql(['test_db5', 'test_db7'])
  })

  it('should dirty if clean or locked when nothing to dirty', async () => {
    await replicators.dirtyIfCleanOrLocked(['test_db2'])
    // test_db2 is already dirty so nothing should be dirtied
    dirties.should.eql([])
  })
})
