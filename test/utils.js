'use strict'

// TODO: need to prefix sieve design doc for testing so doesn't interfer with any other project
// sharing the same DB

const Spiegel = require('../src/spiegel')
const sporks = require('sporks')

class Utils {
  constructor () {
    this.spiegel = this._newSpiegel()
    this._slouch = this.spiegel._slouch
    this._dbNames = []
    this.TIMEOUT = 20000
    this._suffixId = 0
    this._suffix = null
  }

  _newSpiegel () {
    return new Spiegel({ dbName: 'test_spiegel', namespace: 'test_' })
  }

  createSieve (suffix) {
    return this._slouch.doc.create('_global_changes', {
      _id: '_design/' + this.spiegel._namespace + 'sieve',
      views: {
        sieve: {
          map: [
            'function (doc) {',
            'if (/test_db1' + suffix + '|test_db3' + suffix + '/.test(doc._id)) {',
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
    this._dbNames = []
  }

  shouldEqual (var1, var2) {
    // prettier appears to find fault with notation like `(myVar === undefined).should.eql(true)` so
    // this helper function will keep things clean
    let eq = var1 === var2
    eq.should.eql(true)
  }

  shouldNotEqual (var1, var2) {
    // prettier appears to find fault with notation like `(myVar === undefined).should.eql(false)`
    // so this helper function will keep things clean
    let eq = var1 !== var2
    eq.should.eql(true)
  }

  waitFor (poll) {
    return sporks.waitFor(poll, this.TIMEOUT - 2000)
  }

  // TODO: move to sporks?
  spy (obj, funs, calls) {
    funs.forEach(fun => {
      let origFun = obj[fun]

      calls[fun] = []

      obj[fun] = function () {
        calls[fun].push(arguments)
        return origFun.apply(this, arguments)
      }
    })
  }

  nextSuffix () {
    // We need to define a suffix to append to the DB names so that they are unique across tests or
    // else CouchDB will sometimes give us unexpected results in the _global_changes DB
    this._suffixId++
    this._suffix = '_' + this._suffixId
    return this._suffix
  }
}

module.exports = new Utils()
