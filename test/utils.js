'use strict'

// TODO: need to prefix sieve design doc for testing so doesn't interfer with any other project
// sharing the same DB

const Spiegel = require('../src/common/spiegel')

class Utils {
  constructor () {
    this.spiegel = this._newSpiegel()
    this._slouch = this.spiegel._slouch
    this._dbNames = []
    this.TIMEOUT = 10000
  }

  _newSpiegel () {
    return new Spiegel({ dbName: 'test_spiegel', namespace: 'test_' })
  }

  createSieve () {
    return this._slouch.doc.create('_global_changes', {
      _id: '_design/' + this.spiegel._namespace + 'sieve',
      views: {
        sieve: {
          map: [
            'function (doc) {',
            'if (/test_db1|test_db3/.test(doc._id)) {',
            'emit(/:(.*)$/.exec(doc._id)[1]);',
            '}',
            '}'
          ].join(' ')
        }
      }
    })
  }

  destroySieve () {
    return this._slouch.doc.getAndDestroy(
      '_global_changes',
      '_design/' + this.spiegel._namespace + 'sieve'
    )
  }

  async createTestDB (dbName) {
    await this._slouch.db.create(dbName)

    this._dbNames.push(dbName)

    await this._slouch.doc.create(dbName, {
      _id: '1',
      thing: 'play'
    })

    await this._slouch.doc.upsert(dbName, {
      _id: '1',
      thing: 'code'
    })
  }

  async createTestDBs (dbNames) {
    await Promise.all(
      dbNames.map(async dbName => {
        await this.createTestDB(dbName)
      })
    )
  }

  async destroyTestDBs () {
    await Promise.all(
      this._dbNames.map(async dbName => {
        await this._slouch.db.destroy(dbName)
      })
    )
  }
}

module.exports = new Utils()
