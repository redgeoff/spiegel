'use strict'

const PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-adapter-memory'))
const events = require('events')
const utils = require('./utils')
const sporks = require('sporks')
const log = require('./log')

class OnChanges extends events.EventEmitter {
  constructor (spiegel) {
    super()

    this._spiegel = spiegel
    this._slouch = spiegel._slouch

    // We use a memory adapter as we want to be able to read the changes from memory very quickly as
    // they will be read many times over
    this._db = new PouchDB(this._spiegel._namespace + 'on_changes', { adapter: 'memory' })
  }

  _createOnChangesView () {
    var doc = {
      _id: '_design/on_changes',
      views: {
        on_changes: {
          map: [
            'function(doc) {',
            'if (doc.type === "on_change") {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  _createViews () {
    return this._createOnChangesView()
  }

  _destroyViews () {
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/on_changes')
  }

  create () {
    return this._createViews()
  }

  destroy () {
    return this._destroyViews()
  }

  start () {
    // A promise that resolves once the PouchDB has loaded
    let loaded = sporks.once(this, 'load')

    this._from = this._db.replicate
      .from(utils.couchDBURL() + '/' + this._spiegel._dbName, {
        live: true,
        retry: true,
        filter: '_view',
        view: 'on_changes'
      })
      .once('paused', () => {
        // Alert that the data has been loaded and is ready to be used
        this.emit('load')
      })
      .on('error', function (err) {
        log.error(err)
      })

    return loaded
  }

  stop () {
    let completed = sporks.once(this._from, 'complete')
    this._from.cancel()
    return completed
  }

  async all () {
    // Make sure the data has been loaded before querying for all docs
    return this._db.allDocs({ include_docs: true })
  }
}

module.exports = OnChanges