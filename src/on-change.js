'use strict'

const PouchDB = require('pouchdb')
const events = require('events')
const utils = require('./utils')
const sporks = require('sporks')
const log = require('./log')

class OnChange extends events.EventEmitter {
  constructor (spiegel) {
    super()

    this._spiegel = spiegel
    this._slouch = spiegel._slouch
    this._db = new PouchDB('./cache/' + this._spiegel._namespace + 'on_changes')

    // A promise that resolves once the PouchDB has loaded
    this._loaded = sporks.once(this, 'loaded')
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
    this._from = this._db.replicate
      .from(utils.couchDBURL(), {
        live: true,
        retry: true,
        filter: '_view',
        view: 'on_changes'
      })
      .once('paused', () => {
        // Alert that the data has been loaded and is ready to be used
        this.emit('loaded')
      })
      .on('change', function () {})
      .on('error', function (err) {
        log.error(err)
      })
  }

  stop () {
    return this._from.cancel()
  }

  async all () {
    // Make sure the data has been loaded before querying for all docs
    await this._loaded
    return this._db.allDocs()
  }
}

module.exports = OnChange
