'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')
const sporks = require('sporks')
const utils = require('../../src/utils')

describe('replicators', () => {
  let replicators = null
  let replicatorIds = null
  let calls = null
  let globalError = false
  let retryAfterSeconds = 1
  let stalledAfterSeconds = 1

  let conflictError = new Error()
  conflictError.error = 'conflict'

  let nonConflictError = new Error()

  const spy = () => {
    calls = []
    testUtils.spy(
      replicators,
      [
        '_lockAndThrowIfErrorAndNotConflict',
        '_replicateAndUnlockIfError',
        '_unlockAndCleanIfConflictJustUnlock',
        '_upsertUnlock',
        '_lockReplicateUnlockLogError',
        '_changes',
        '_unlockStalledReplicators',
        '_unlock'
      ],
      calls
    )
  }

  const listenForErrors = () => {
    replicators.once('err', function (err) {
      globalError = err
    })
  }

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel, { retryAfterSeconds, stalledAfterSeconds })
    replicatorIds = []
    spy()
    listenForErrors()
  })

  afterEach(async () => {
    await Promise.all(
      replicatorIds.map(async id => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, id)
      })
    )
    await testUtils.destroyTestDBs()

    // Was there an error?
    if (globalError) {
      throw globalError
    }
  })

  const createReplicator = async replicator => {
    replicator.type = 'replicator'
    let doc = await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, replicator)
    replicatorIds.push(doc.id)
    return {
      _id: doc.id,
      _rev: doc.rev
    }
  }

  const createTestReplicator = async () => {
    let rep = await createReplicator({
      source: 'https://example.com/test_db1'
    })
    return replicators._get(rep._id)
  }

  const fakeSuccessfulReplication = () => {
    replicators._replicate = sporks.resolveFactory()
  }

  it('should extract db name', function () {
    replicators._toDBName('http://example.com:5984/mydb').should.eql('mydb')

    // We don't really care about this case as we require the source to be a FQDN
    testUtils.shouldEqual(replicators._toDBName('mydb'), undefined)

    testUtils.shouldEqual(replicators._toDBName(''), undefined)

    testUtils.shouldEqual(replicators._toDBName(), undefined)
  })

  it('should lock replicator', async () => {
    // Create replicator
    let replicator = await createReplicator({
      source: 'https://example.com/test_db1'
    })

    // Lock replicator
    let lockedReplicator = await replicators._lock(replicator)

    // Get the saved replicator and compare
    let savedReplicator = await replicators._get(replicator._id)
    savedReplicator.should.eql(lockedReplicator)

    // The rev should have changed
    lockedReplicator._rev.should.not.eql(replicator._rev)

    // The locked_at value should have been populated
    lockedReplicator.locked_at.should.not.eql(undefined)

    // The updated_at value should have been populated
    lockedReplicator.updated_at.should.not.eql(undefined)
  })

  it('lock should throw when conflict', async () => {
    // Create replicator
    let replicator = await createReplicator({
      source: 'https://example.com/test_db1'
    })

    // Modify replicator to simulate a conflict later
    replicator.dirty = true
    await testUtils.spiegel._slouch.doc.update(testUtils.spiegel._dbName, replicator)

    let savedReplicator1 = await replicators._get(replicator._id)

    let err = null
    try {
      // Lock replicator
      await replicators._lock(replicator)
    } catch (_err) {
      err = _err
    }
    testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)

    // Get the saved replicator and make sure nothing changed
    let savedReplicator2 = await replicators._get(replicator._id)
    savedReplicator2.should.eql(savedReplicator1)
  })

  it('should convert to CouchDB replication params', async () => {
    // Sanity test some params
    let params = {
      cancel: true,
      continuous: true,
      create_target: true,
      doc_ids: true,
      filter: true,
      proxy: true,
      source: true,
      target: true
    }

    let couchParams = replicators._toCouchDBReplicationParams(params)

    couchParams.should.eql({
      create_target: true,
      doc_ids: true,
      filter: true,
      proxy: true,
      source: true,
      target: true
    })
  })

  it('should add passwords', function () {
    // Clear any passwords
    replicators._passwords = null

    // Should be unchanged as there is no passwords mapping
    replicators
      ._addPassword('http://user1@example.com/mydb')
      .should.eql('http://user1@example.com/mydb')

    // Fake passwords
    replicators._passwords = {
      'example.com': {
        user1: 'password1',
        user2: 'password2'
      },
      'google.com': {
        user1: 'password'
      }
    }

    replicators
      ._addPassword('http://user1@example.com/mydb')
      .should.eql('http://user1:password1@example.com/mydb')

    replicators
      ._addPassword('https://user2@example.com/mydb')
      .should.eql('https://user2:password2@example.com/mydb')

    replicators
      ._addPassword('https://user1@google.com/mydb')
      .should.eql('https://user1:password@google.com/mydb')

    replicators
      ._addPassword('https://usermissing@example.com/mydb')
      .should.eql('https://usermissing@example.com/mydb')

    replicators
      ._addPassword('https://usermissing@missing.com/mydb')
      .should.eql('https://usermissing@missing.com/mydb')
  })

  const shouldUpsertUnlock = async simulateConflict => {
    // Create replicator
    let replicator = await createReplicator({
      source: 'https://example.com/test_db1',
      locked_at: new Date().toISOString(),
      dirty: true
    })

    // Get saved replicator
    let savedReplicator1 = await replicators._get(replicator._id)

    if (simulateConflict) {
      // Simulate conflict
      await replicators._updateReplicator(savedReplicator1)
      let savedReplicator1a = await replicators._get(replicator._id)
      savedReplicator1a._rev.should.not.eql(savedReplicator1._rev)
    }

    // Upsert unlock
    await replicators._upsertUnlock(replicator)

    // Get saved replicator
    let savedReplicator2 = await replicators._get(replicator._id)

    // It should be unlocked
    testUtils.shouldEqual(savedReplicator2.locked_at, null)

    // Other attrs like dirty should not have changed
    savedReplicator2.dirty.should.eql(true)

    // updated_at should have changed
    savedReplicator2.updated_at.should.not.eql(savedReplicator1.updated_at)

    // rev should be different
    savedReplicator2._rev.should.not.eql(savedReplicator1._rev)
  }

  it('should upsert unlock', async () => {
    await shouldUpsertUnlock()
  })

  it('should upsert unlock when conflict', async () => {
    await shouldUpsertUnlock(true)
  })

  const shouldUnlockAndClean = async simulateConflict => {
    // Create replicator
    let replicator = await createReplicator({
      source: 'https://example.com/test_db1',
      locked_at: new Date().toISOString(),
      dirty: true
    })

    // Get saved replicator
    let savedReplicator1 = await replicators._get(replicator._id)

    let savedReplicator1a = null
    if (simulateConflict) {
      // Simulate conflict
      await replicators._updateReplicator(savedReplicator1)
      savedReplicator1a = await replicators._get(replicator._id)
      savedReplicator1a._rev.should.not.eql(savedReplicator1._rev)
    }

    let err = null
    try {
      // Unlock and clean
      await replicators._unlockAndClean(replicator)
    } catch (_err) {
      err = _err
    }

    // Get saved replicator
    let savedReplicator2 = await replicators._get(replicator._id)

    if (simulateConflict) {
      testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)

      // It should remain locked
      savedReplicator2.locked_at.should.eql(savedReplicator2.locked_at)

      // Should remain dirty
      savedReplicator2.dirty.should.eql(true)

      // updated_at should not have changed
      savedReplicator2.updated_at.should.eql(savedReplicator1a.updated_at)

      // rev should not be different
      savedReplicator2._rev.should.eql(savedReplicator1a._rev)
    } else {
      // It should be unlocked
      testUtils.shouldEqual(savedReplicator2.locked_at, null)

      // Should be clean
      savedReplicator2.dirty.should.eql(false)

      // updated_at should have changed
      savedReplicator2.updated_at.should.not.eql(savedReplicator1.updated_at)

      // rev should be different
      savedReplicator2._rev.should.not.eql(savedReplicator1._rev)
    }
  }

  it('should unlock and clean', async () => {
    await shouldUnlockAndClean()
  })

  it('should not unlock and clean when conflict', async () => {
    await shouldUnlockAndClean(true)
  })

  it('_lockReplicateUnlock should handle non-conflict error when locking', async () => {
    let replicator = await createTestReplicator()

    // Fake non-conflict error
    replicators._lock = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return replicators._lockReplicateUnlock(replicator)
    }, nonConflictError)

    // Make sure other calls are then skipped
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._replicateAndUnlockIfError.length.should.eql(0)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockReplicateUnlock should handle conflict when locking', async () => {
    let replicator = await createTestReplicator()

    // Fake conflict error
    replicators._lock = sporks.promiseErrorFactory(conflictError)

    await replicators._lockReplicateUnlock(replicator)

    // Make sure other calls are then skipped
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._replicateAndUnlockIfError.length.should.eql(0)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockReplicateUnlock should handle error when replicating', async () => {
    let replicator = await createTestReplicator()

    // Fake conflict error
    replicators._replicate = sporks.promiseErrorFactory(conflictError)

    await sporks.shouldThrow(() => {
      return replicators._lockReplicateUnlock(replicator)
    }, conflictError)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._replicateAndUnlockIfError.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockReplicateUnlock should handle non-conflict error when cleaning', async () => {
    let replicator = await createTestReplicator()

    fakeSuccessfulReplication()

    // Fake non-conflict error
    replicators._unlockAndClean = sporks.promiseErrorFactory(nonConflictError)

    await sporks.shouldThrow(() => {
      return replicators._lockReplicateUnlock(replicator)
    }, nonConflictError)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._replicateAndUnlockIfError.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(0)
  })

  it('_lockReplicateUnlock should handle conflict error when cleaning', async () => {
    let replicator = await createTestReplicator()

    fakeSuccessfulReplication()

    // Fake conflict error
    replicators._unlockAndClean = sporks.promiseErrorFactory(conflictError)

    await replicators._lockReplicateUnlock(replicator)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._replicateAndUnlockIfError.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(1)
  })

  it('should _lockReplicateUnlock without errors', async () => {
    let replicator = await createTestReplicator()

    fakeSuccessfulReplication()

    await replicators._lockReplicateUnlock(replicator)

    // Check calls
    calls._lockAndThrowIfErrorAndNotConflict.length.should.eql(1)
    calls._replicateAndUnlockIfError.length.should.eql(1)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(1)
    calls._upsertUnlock.length.should.eql(0)
  })

  const testDBNames = () => {
    return ['test_db1' + testUtils.nextSuffix(), 'test_db2' + testUtils.nextSuffix()]
  }

  const createReplicators = async dbNames => {
    await createReplicator({
      source: utils.couchDBURL() + '/' + dbNames[0],
      target: utils.couchDBURL() + '/' + dbNames[0],
      dirty: true
    })

    await createReplicator({
      source: utils.couchDBURL() + '/' + dbNames[1],
      target: utils.couchDBURL() + '/' + dbNames[1],
      dirty: true
    })
  }

  const lockReplicateUnlockLogErrorShouldEql = dbNames => {
    calls._lockReplicateUnlockLogError.length.should.eql(2)

    // Order is not guaranteed so we index by source
    let indexedReplicators = {}
    calls._lockReplicateUnlockLogError.forEach(args => {
      indexedReplicators[args[0].source] = { source: args[0].source, target: args[0].target }
    })
    indexedReplicators[utils.couchDBURL() + '/' + dbNames[0]].source.should.eql(
      utils.couchDBURL() + '/' + dbNames[0]
    )
    indexedReplicators[utils.couchDBURL() + '/' + dbNames[0]].target.should.eql(
      utils.couchDBURL() + '/' + dbNames[0]
    )
    indexedReplicators[utils.couchDBURL() + '/' + dbNames[1]].source.should.eql(
      utils.couchDBURL() + '/' + dbNames[1]
    )
    indexedReplicators[utils.couchDBURL() + '/' + dbNames[1]].target.should.eql(
      utils.couchDBURL() + '/' + dbNames[1]
    )
  }

  it('should start when replicators already dirty', async () => {
    let dbNames = testDBNames()

    await createReplicators(dbNames)

    await testUtils.createTestDBs(dbNames)

    await replicators.start()

    // Verify start with lastSeq. 1st entry is the _getLastSeq() called by _start() and then finally
    // the call by _listen()
    testUtils.shouldNotEqual(calls._changes[1][0].since, undefined)

    lockReplicateUnlockLogErrorShouldEql(dbNames)

    await replicators.stop()
  })

  it('should start with no replicators dirty', async () => {
    let dbNames = testDBNames()

    await replicators.start()

    await createReplicators(dbNames)

    await testUtils.createTestDBs(dbNames)

    await testUtils.waitFor(() => {
      return calls._lockReplicateUnlockLogError.length === 2 ? true : undefined
    })

    lockReplicateUnlockLogErrorShouldEql(dbNames)

    await replicators.stop()
  })

  it('should unstall', async () => {
    let dbNames = testDBNames()

    let replicator1 = await createReplicator({
      source: utils.couchDBURL() + '/' + dbNames[0],
      target: utils.couchDBURL() + '/' + dbNames[0],
      dirty: true,

      // Should be retried when unstaller runs a second time
      locked_at: new Date(new Date().getTime() - retryAfterSeconds * 1000 / 2).toISOString()
    })

    // A decoy that should not be unstalled as it is not locked
    await createReplicator({
      source: utils.couchDBURL() + '/' + dbNames[1],
      target: utils.couchDBURL() + '/' + dbNames[1],
      dirty: true
    })

    let replicator3 = await createReplicator({
      source: utils.couchDBURL() + '/' + dbNames[1],
      target: utils.couchDBURL() + '/' + dbNames[1],
      dirty: true,

      // Should be retried when unstaller first runs
      locked_at: new Date(new Date().getTime() - retryAfterSeconds * 1000 * 2).toISOString()
    })

    await testUtils.createTestDBs(dbNames)

    await replicators.start()

    // Wait for unstaller to loop twice
    await testUtils.waitFor(() => {
      return calls._unlockStalledReplicators.length === 2 ? true : undefined
    })

    calls._unlock[0][0]._id.should.eql(replicator1._id)
    calls._unlock[1][0]._id.should.eql(replicator3._id)

    await replicators.stop()
  })
})
