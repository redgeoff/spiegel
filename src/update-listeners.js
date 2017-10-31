'use strict'

// TODO: need to save lastSeq after opts.saveLastSeqTimeout

const Globals = require('./globals')
const log = require('./log')
const sporks = require('sporks')

class UpdateListeners {
  constructor (spiegel, opts) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch
    this._globals = new Globals(spiegel)

    // The maximum number of updates that will be processed in this batch
    this._batchSize = opts && opts.batchSize ? opts.batchSize : 100

    // The time to wait after an update before the batch is considered done regardless of whether
    // there are any more updates
    this._batchTimeout = opts && opts.batchTimeout ? opts.batchTimeout : 1000

    this._lastSeq = null

    this._stopped = false
  }

  // The sieve is primarily used to filter out:
  //   1. Any updates that are not for DB changes
  //   2. Any updates to the spiegel DB
  //
  // This filtering out allows our UpdateListener to process updates faster and requires that less
  // data is sent from CouchDB to our UpdateListener.
  //
  // The sieve can also be used to further speed up the processing of updates by filtering on just
  // specific DBs. Be careful when doing this as your sieve could block replications and change
  // listening if it is not configured properly.
  _createSieve () {
    return this._slouch.doc.create('_global_changes', {
      _id: '_design/' + this._spiegel._namespace + 'sieve',
      views: {
        sieve: {
          map: [
            'function (doc) {',
            'if (/:(.*)$/.test(doc._id) && !/:' + this._spiegel._dbName + '$/.test(doc._id)) {',
            'emit(/:(.*)$/.exec(doc._id)[1]);',
            '}',
            '}'
          ].join(' ')
        }
      }
    })
  }

  _destroySieve () {
    return this._slouch.doc.getAndDestroy(
      '_global_changes',
      '_design/' + this._spiegel._namespace + 'sieve'
    )
  }

  install () {
    return this._createSieve()
  }

  uninstall () {
    return this._destroySieve()
  }

  _onError (err) {
    log.error(err)
  }

  _startBatchTimeout (iterator) {
    setTimeout(() => {
      iterator.abort()
    }, this._batchTimeout)
  }

  _toDBName (update) {
    return /:(.*)$/.exec(update.id)[1]
  }

  _addToUpdatedDBs (update) {
    // We index by dbName to remove duplicates in the batch
    this._updatedDBs[this._toDBName(update)] = true
  }

  _dbUpdatesIteratorEach () {
    let i = 0

    return this._dbUpdatesIterator.each(update => {
      this._addToUpdatedDBs(update)

      this._lastSeq = update.seq

      if (i === 0) {
        // The 1st update can take any amount of time, but after it is read, we want to start a
        // timer. If the timer expires then we want to close the stream and consider the batch
        // collected. We pass in the iterator as by the time the timeout completes we have already
        // created a new _dbUpdatesIterator
        this._startBatchTimeout(this._dbUpdatesIterator)
      }

      if (i === this._batchSize - 1) {
        this._dbUpdatesIterator.abort()
      }

      i++
    })
  }

  _replicatorsDirtyIfCleanOrLocked (dbNames) {
    return this._spiegel._replicators.dirtyIfCleanOrLocked(dbNames)
  }

  _changeListenersDirtyIfCleanOrLocked (dbNames) {
    return this._spiegel._changeListeners.dirtyIfCleanOrLocked(dbNames)
  }

  _matchWithDBNames (dbNames) {
    return this._spiegel._onChanges.matchWithDBNames(dbNames)
  }

  async _matchAndDirtyFiltered (dbNames) {
    // Filter dbNames by OnChanges and then only dirty the corresponding ChangeListeners
    let filteredDBNames = await this._matchWithDBNames(dbNames)

    // Are there ChangeListeners to dirty?
    if (filteredDBNames.length > 0) {
      // We use bulk operations to get and then dirty/create ChangeListeners so that the listening
      // can be delegated to one of the ChangeListener processes.
      await this._changeListenersDirtyIfCleanOrLocked(filteredDBNames)
    }
  }

  async _processNextBatch () {
    let dbNames = sporks.keys(this._updatedDBs)

    // We use bulk operations to get and then dirty replicators so that replication can be delegated
    // to one of the replicator processes.
    await this._replicatorsDirtyIfCleanOrLocked(dbNames)

    await this._matchAndDirtyFiltered(dbNames)
  }

  // Separate out for easier unit testing
  _changes (opts) {
    return this._slouch.db.changes('_global_changes', opts)
  }

  async _listenToNextBatch () {
    // Clear any previous batch of updates
    this._updatedDBs = []

    this._dbUpdatesIterator = this._changes({
      feed: 'continuous',
      heartbeat: true,
      since: this._lastSeq,

      filter: '_view',
      view: this._spiegel._namespace + 'sieve/sieve',

      // Avoid reading more than we are willing to process in this batch
      limit: this._batchSize
    })

    this._dbUpdatesIterator.on('error', err => {
      this._onError(err)
    })

    await this._dbUpdatesIteratorEach()

    // Make sure that nothing else is processed when we have stopped
    if (!this._stopped) {
      await this._processNextBatch()
    }
  }

  async _listen () {
    try {
      await this._listenToNextBatch()

      // Make sure that nothing else is processed when we have stopped
      if (!this._stopped) {
        // We don't await here as we just want _listen to be called again and don't want to have to
        // waste memory chaining the promises
        this._listen()
      }
    } catch (err) {
      // Log fatal error here as this is in our listening loop, which is detached from our starting
      // chain of promises
      log.fatal(err)
    }
  }

  async start () {
    this._lastSeq = await this._globals.get('lastSeq')
    this._listen()
  }

  stop () {
    this._stopped = true
    if (this._dbUpdatesIterator) {
      this._dbUpdatesIterator.abort()
    }
  }
}

module.exports = UpdateListeners
