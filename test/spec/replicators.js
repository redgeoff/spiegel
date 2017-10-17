'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')

describe('replicators', () => {
  let replicators = null
  let replicatorIds = null
  let upserts = null

  const spy = () => {
    replicators._upsert = function (replicator) {
      upserts.push(replicator)
      return Replicators.prototype._upsert.apply(this, arguments)
    }
  }

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel)
    replicatorIds = []
    upserts = []
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
    let lockedReplicator = await replicators.lock(replicator)

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

    try {
      // Lock replicator
      await replicators.lock(replicator)
    } catch (err) {
      testUtils.spiegel._slouch.doc.isConflictError(err).should.eql(true)
    }

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

    replicators._toCouchDBReplicationParams(params)

    params.should.eql({
      create_target: true,
      doc_ids: true,
      filter: true,
      proxy: true,
      source: true,
      target: true
    })
  })
})
