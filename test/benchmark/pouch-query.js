'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
chai.should()

const testUtils = require('../utils')
const PouchDB = require('pouchdb')
const slouch = testUtils.spiegel._slouch
const sporks = require('sporks')
const utils = require('../../src/utils')

// Question: What is the fastest way to look up a replicator in a local CouchDB instance?

describe('pouch-query', function () {
  this.timeout(10000)

  let db = null
  let from = null
  const N = 2
  const DB_NAME = 'test_replicators'

  const createDB = () => {
    return slouch.db.create(DB_NAME)
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
    return slouch.doc.create(DB_NAME, {
      _id: 'replicator_' + i,
      db_name: 'test_db' + i
    })
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

  const startReplicating = () => {
    return new Promise(function (resolve, reject) {
      from = db.replicate
        .from(utils.couchDBURL() + '/' + DB_NAME, {
          live: true,
          retry: true
        })
        .once('paused', () => {
          // Alert that the data has been loaded and is ready to be used
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
    db = new PouchDB(utils.levelPath() + '/test_bm_replicators')
    await createDB()
    await createReplicatorsByDBNameView()
    await createDocs()
    await startReplicating()
  })

  afterEach(async () => {
    await stopReplicating()
    await db.destroy()
    await destroyDB()
  })

  it('should find', async () => {
    let docs = await db.allDocs({ include_docs: true })
    docs.rows.forEach(function (doc) {
      console.log('doc=', doc)
    })
  })

  // it('should query', () => {})
})
