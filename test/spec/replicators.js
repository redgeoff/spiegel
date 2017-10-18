'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('replicators', () => {
  let replicators = null
  let replicatorIds = null
  let calls = null

  const spy = () => {
    calls = []
    testUtils.spy(
      replicators,
      [
        '_lockReplicateUnlock',
        '_replicateAndUnlockIfError',
        '_unlockAndCleanIfConflictJustUnlock',
        '_upsertUnlock'
      ],
      calls
    )
  }

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel)
    replicatorIds = []
    spy()
  })

  afterEach(async () => {
    await Promise.all(
      replicatorIds.map(async id => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, id)
      })
    )
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
    let replicator = createTestReplicator()

    // Fake non-conflict error
    let err = new Error()
    replicators._lock = sporks.promiseErrorFactory(err)

    await sporks.shouldThrow(() => {
      return replicators._lockReplicateUnlock(replicator)
    }, err)

    // Make sure other calls are then skipped
    calls._replicateAndUnlockIfError.length.should.eql(0)
    calls._unlockAndCleanIfConflictJustUnlock.length.should.eql(0)
  })

  it('_lockReplicateUnlock should handle conflict when locking', async () => {})

  it('_lockReplicateUnlock should handle error when replicating', async () => {})

  it('_lockReplicateUnlock should handle non-conflict error when cleaning', async () => {})

  it('_lockReplicateUnlock should handle conflict error when cleaning', async () => {})

  it('should _lockReplicateUnlock without errors', async () => {})

  // TODO: test listen loop
  // - start with replicators already being dirty
  // - start with no replicators dirty
})
