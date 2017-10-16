'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
chai.should()

const testUtils = require('../utils')
const PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-find'))
const slouch = testUtils.spiegel._slouch
const sporks = require('sporks')
const utils = require('../../src/utils')

// Question: What is the fastest way to look up a replicator in a local CouchDB instance using the
//           node leveldown adapter?
//
// * N=10,000
//     Test               1st Read    2nd Read
//   * find w/o index:       807ms       810ms
//   * find w/ index:       2900ms         3ms
//   * query w/ view:      12955ms         3ms
//
// * N=100,000 (158,624ms for initial PouchDB replicatation)
//     Test               1st Read    2nd Read    Space
//   * find w/o index:      6303ms      7615ms      15M
//   * find w/ index:      27206ms        10ms      36M
//   * query w/ view:     129035ms         3ms      36M

describe('pouch-query', function () {
  this.timeout(100000000)

  let db = null
  let from = null
  const N = 10000
  const DB_NAME = 'test_replicators'

  const createDB = async () => {
    await slouch.db.create(DB_NAME)
    await createReplicatorsByDBNameView()
    await createDocs()
  }

  const destroyDB = () => {
    return slouch.db.destroy(DB_NAME)
  }

  const createReplicatorsByDBNameView = () => {
    var doc = {
      _id: '_design/replicators_by_db_name',
      views: {
        replicators_by_db_name: {
          map: ['function(doc) {', 'emit(doc.db_name, null);', '}'].join(' ')
        }
      }
    }

    return slouch.doc.createOrUpdate(DB_NAME, doc)
  }

  const createDocFactory = i => {
    return function () {
      console.log('creating doc for i=', i)
      return slouch.doc.create(DB_NAME, {
        _id: 'replicator_' + i,
        db_name: 'test_db' + i
      })
    }
  }

  const createDocs = () => {
    let chain = Promise.resolve()

    // Create docs sequentially as we are going to create a lot of them and we don't want to run out
    // of memory creating them concurrently
    for (let i = 1; i <= N; i++) {
      chain = chain.then(createDocFactory(i))
    }

    return chain
  }

  const createPouchIndex = () => {
    return db.createIndex({
      index: {
        fields: ['db_name'],
        name: 'replicators_by_db_name_index'
      }
    })
  }

  const startReplicating = () => {
    let before = new Date()
    return new Promise(function (resolve, reject) {
      from = db.replicate
        .from(utils.couchDBURL() + '/' + DB_NAME, {
          live: true,
          retry: true
        })
        .once('paused', () => {
          // Alert that the data has been loaded and is ready to be used
          let after = new Date()
          console.log('took', after.getTime() - before.getTime(), 'ms to replicate')
          resolve()
        })
        .on('error', function (err) {
          reject(err)
        })
    })
  }

  const stopReplicating = () => {
    let completed = sporks.once(from, 'complete')
    from.cancel()
    return completed
  }

  beforeEach(async () => {
    await createDB()
    db = new PouchDB(utils.levelPath() + '/test_bm_replicators')
    await createPouchIndex()
    await startReplicating()
  })

  afterEach(async () => {
    await stopReplicating()
    await db.destroy()
    await destroyDB()
  })

  const find = async () => {
    let before = new Date()

    let docs = await db.find({
      selector: { db_name: 'test_db' + N }
    })

    let after = new Date()

    console.log('docs=', docs.docs)
    console.log('read took', after.getTime() - before.getTime(), 'ms')

    docs.docs.length.should.eql(1)
  }

  it('should find', async () => {
    // let indexes = await db.getIndexes()
    // console.log('indexes=', indexes)
    await find()
    await find()
  })

  const query = async () => {
    let before = new Date()

    let docs = await db.query('replicators_by_db_name', {
      key: 'test_db' + N
    })

    let after = new Date()

    console.log('docs=', docs)
    console.log('read took', after.getTime() - before.getTime(), 'ms')

    docs.rows.length.should.eql(1)
  }

  it('should query with view', async () => {
    await query()
    await query()
  })
})
