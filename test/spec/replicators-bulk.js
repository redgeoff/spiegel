'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')

describe('replicators-bulk', () => {
  let replicators = null
  let docs = []

  const createReplicator = async replicator => {
    replicator.type = 'replicator'
    let doc = await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, replicator)
    docs.push(doc)
  }

  const createReplicators = async () => {
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

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel)
    await createReplicators()
  })

  afterEach(async () => {
    await Promise.all(
      docs.map(async doc => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, doc.id)
      })
    )
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

    // Simulate conflicts by updating the docs between the _getCleanOrLocked() and _dirty() calls
    await testUtils.spiegel._slouch.doc.getMergeUpdate(testUtils.spiegel._dbName, {
      _id: docs[4].id,
      foo: 'bar'
    })
    await testUtils.spiegel._slouch.doc.getMergeUpdate(testUtils.spiegel._dbName, {
      _id: docs[6].id,
      foo: 'bar'
    })

    let conflictedDBNames = await replicators._dirtyAndGetConflictedDBNames(reps)
    conflictedDBNames.should.eql(['test_db5', 'test_db7'])
  })

  // it('should dirty if clean or locked', async () => {
  //   await replicators.dirtyIfCleanOrLocked([
  //     'test_db1',
  //     'test_db2',
  //     'test_db4',
  //     'test_db5',
  //     'test_db6',
  //     'test_db7'
  //   ])
  //   // TODO: check replicators
  // })

  // TODO: should dirty if clean or locked when nothing to dirty
})