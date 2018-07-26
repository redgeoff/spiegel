'use strict'

const PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-adapter-memory'))
const events = require('events')
const utils = require('./utils')
const sporks = require('sporks')
const log = require('./log')

// Note: during the benchmark tests, it was determined that it is 10 times faster to iterate through
// 2 docs in a simple array than via the PouchDB memory adapter. Therefore, we will use PouchDB to
// sync the data, but will store the docs in a simple array as we want our UpdateListener to be able
// to iterate through all OnChanges as fast as possible

class OnChanges extends events.EventEmitter {
  constructor(spiegel) {
    super()

    this._spiegel = spiegel
    this._slouch = spiegel._slouch

    // As per https://pouchdb.com/adapters.html, two PouchDB instances using the memory adapter with
    // the same name share the same store and we need each instance to have its own store. In
    // particular, this is needed when we are testing and are launching multiple instances of
    // OnChanges from within the same node process. If we don't separate this namespace then race
    // conditions can result in some OnChanges not receiving necessary changes.
    this._id = OnChanges._getNextId()
    this._db = new PouchDB(this._spiegel._namespace + 'on_changes_' + this._id, {
      adapter: 'memory'
    })

    this._docs = {}

    // A promise that resolves once the PouchDB data has loaded
    this._loaded = sporks.once(this, 'load')

    this._running = false
  }

  _createOnChangesView() {
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

  _createViews() {
    return this._createOnChangesView()
  }

  _destroyViews() {
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/on_changes')
  }

  install() {
    return this._createViews()
  }

  uninstall() {
    return this._destroyViews()
  }

  _create(onChange) {
    onChange.type = 'on_change'
    return this._slouch.doc.create(this._spiegel._dbName, onChange)
  }

  _getAndDestroy(id) {
    // We need to use markAsDestroyed() as PouchDB can only sync deletions when they are done using
    // the _deleted flag
    return this._slouch.doc.markAsDestroyed(this._spiegel._dbName, id)
  }

  _setDoc(doc) {
    if (doc._deleted) {
      delete this._docs[doc._id]
    } else {
      this._docs[doc._id] = doc
    }
  }

  async _loadAllDocs() {
    let docs = await this._db.allDocs({ include_docs: true })
    docs.rows.forEach(doc => {
      this._setDoc(doc.doc)
    })
  }

  async _onPaused() {
    await this._loadAllDocs()

    // Alert that the data has been loaded and is ready to be used
    this.emit('load')
  }

  _setDocs(docs) {
    docs.forEach(doc => {
      this._setDoc(doc)
    })
  }

  isRunning() {
    return this._running
  }

  _onError(err) {
    // TODO: should an error be emitted so that spiegel layer can listen for it and also emit
    // it?
    log.error(err)
  }

  _replicateFrom() {
    return this._db.replicate.from.apply(this._db.replicate, arguments)
  }

  _startReplicatingFrom() {
    let from = this._replicateFrom(utils.couchDBURL() + '/' + this._spiegel._dbName, {
      live: true,
      retry: true,
      filter: '_view',
      view: 'on_changes'
    })

    from
      .once('paused', () => {
        this._onPaused()
      })
      .on('error', err => {
        this._onError(err)
      })
      .on('change', change => {
        this._setDocs(change.docs)
        this.emit('change')
      })

    return from
  }

  start() {
    this._running = true
    this._from = this._startReplicatingFrom()
    return this._loaded
  }

  async stop() {
    let completed = sporks.once(this._from, 'complete')
    this._from.cancel()
    await completed
    this._running = false
  }

  async all() {
    // all() is a promise so that we have the freedom to change up the storage mechanism in the
    // future, e.g. our future storage mechanism may require IO
    await this._loaded
    return this._docs
  }

  async matchWithDBNames(dbNames) {
    // TODO: if we want to speed up this function even more, we can instead build a single reg ex,
    // e.g. /(on-change-db-name-1)|(on-change-db-name-1)|(...)/ and do a single comparison. This
    // most likely will have little impact on the performance of the UpdateListener however as the
    // main bottleneck will probably be in the UpdateListener communicating with CouchDB, i.e.
    // dirtying replicators and change liseteners.

    let docs = await this.all()

    let matchingDBNames = {}

    sporks.each(docs, doc => {
      let re = new RegExp(doc.db_name)
      dbNames.forEach(dbName => {
        // Does the name match the regular expression?
        if (re.test(dbName)) {
          // Index by name to prevent duplicates
          matchingDBNames[dbName] = true
        }
      })
    })

    return sporks.keys(matchingDBNames)
  }

  async getMatchingOnChanges(dbName, doc) {
    let onChanges = await this.all()

    let matchingOnChanges = {}

    sporks.each(onChanges, onChange => {
      // Does the DB name match?
      let dbNameRegExp = new RegExp(onChange.db_name)
      if (dbNameRegExp.test(dbName)) {
        let ok = true

        // Was an if condition specified?
        if (onChange.if) {
          // Loop for each attribute
          sporks.each(onChange.if, (reStr, name) => {
            if(reStr === null) {
              ok = ok && (!(name in doc) || doc[name] === null)
            } else {
              let re = new RegExp(reStr)

              // Condition failed?
              if (!re.test(doc[name])) {
                ok = false
              }
            }
          })
        }

        if (ok) {
          matchingOnChanges[onChange._id] = onChange
        }
      }
    })

    return matchingOnChanges
  }
}

OnChanges._nextId = 0

OnChanges._getNextId = () => {
  return OnChanges._nextId++
}

module.exports = OnChanges
