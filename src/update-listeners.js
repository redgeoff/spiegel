'use strict'

const Globals = require('./globals')
const log = require('./log')
const sporks = require('sporks')
const utils = require('./utils')
const urlSafe = require('querystring').escape
const Synchronizer = require('squadron').Synchronizer

class UpdateListeners {
  constructor(spiegel, opts) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch
    this._globals = new Globals(spiegel)

    // Used to synchronize calls so that batch processing is atomic
    this._synchronizer = new Synchronizer()

    // The maximum number of updates that will be processed in this batch
    this._batchSize = utils.getOpt(opts, 'batchSize', 100)

    // The time to wait after an update before the batch is considered done regardless of whether
    // there are any more updates
    this._batchTimeout = utils.getOpt(opts, 'batchTimeout', 1000)

    this._saveSeqAfterSeconds = utils.getOpt(opts, 'saveSeqAfterSeconds', 60)

    this._seqLastSaved = null

    this._lastSeq = null

    this._stopped = false

    this._resetForNextBatch()
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
  _createSieve() {
    return this._slouch.doc.createOrUpdate('_global_changes', {
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

  _destroySieve() {
    return this._slouch.doc.getAndDestroy(
      '_global_changes',
      '_design/' + this._spiegel._namespace + 'sieve'
    )
  }

  install() {
    return this._createSieve()
  }

  uninstall() {
    return this._destroySieve()
  }

  _onError(err) {
    log.error(err)
  }

  _startBatchTimeout() {
    this._batchTimer = setTimeout(() => {
      // The batch timer expired so process the batch
      this._processBatch()
    }, this._batchTimeout)
  }

  _toDBName(update) {
    // Return URL safe DB name to avoid issues with slashes in db names
    return urlSafe(/:(.*)$/.exec(update.id)[1])
  }

  _addToUpdatedDBs(update) {
    // We index by dbName to remove duplicates in the batch
    this._updatedDBs[this._toDBName(update)] = true
  }

  async _resetForNextBatch() {
    // Stop the batch timer
    clearTimeout(this._batchTimer)

    // Reset the counter
    this._updateCount = 0

    // Clear any previous batch of updates
    this._updatedDBs = []
  }

  async _processUpdatedDBs() {
    let dbNames = sporks.keys(this._updatedDBs)

    // We use bulk operations to get and then dirty replicators so that replication can be delegated
    // to one of the replicator processes.
    await this._replicatorsDirtyIfCleanOrLocked(dbNames)

    await this._matchAndDirtyFiltered(dbNames)
  }

  async _processBatchUnsynchronized() {
    await this._processUpdatedDBs()

    this._resetForNextBatch()

    await this._saveLastSeqIfNeeded()
  }

  async _processBatch() {
    await this._synchronizer.run(async() => {
      await this._processBatchUnsynchronized()
    })
  }

  async _onUpdateUnsynchronized(update) {
    log.debug('Processing update ' + JSON.stringify(update))

    this._addToUpdatedDBs(update)

    this._lastSeq = update.seq

    if (this._updateCount === 0) {
      // The 1st update can take any amount of time, but after it is read, we want to start a
      // timer. If the timer expires then we want to consider the batch collected.
      this._startBatchTimeout()
    }

    if (this._updateCount === this._batchSize - 1) {
      // Wait until the batch has been processed so that our listening on the _global_changes is
      // paused until we are ready for the next set of changes.
      await this._processBatchUnsynchronized()
    } else {
      this._updateCount++
    }
  }

  async _onUpdate(update) {
    // We need to synchronize _onUpdate with _processBatch as there is some shared memory, e.g.
    // _updatedDBs, _updateCount, ...
    await this._synchronizer.run(async() => {
      await this._onUpdateUnsynchronized(update)
    })
  }

  _dbUpdatesIteratorEach() {
    let r = new RegExp(':' + this._spiegel._dbName + '$')
    return this._dbUpdatesIterator.each(async update => {
      if (/:(.*)$/.test(update.id) && !r.test(update.id)) {
        await this._onUpdate(update)
      }
    })
  }

  _replicatorsDirtyIfCleanOrLocked(dbNames) {
    return this._spiegel._replicators.dirtyIfCleanOrLocked(dbNames, new Date())
  }

  _changeListenersDirtyIfCleanOrLocked(dbNames) {
    return this._spiegel._changeListeners.dirtyIfCleanOrLocked(dbNames)
  }

  _matchWithDBNames(dbNames) {
    return this._spiegel._onChanges.matchWithDBNames(dbNames)
  }

  async _matchAndDirtyFiltered(dbNames) {
    // Filter dbNames by OnChanges and then only dirty the corresponding ChangeListeners
    let filteredDBNames = await this._matchWithDBNames(dbNames)

    // Are there ChangeListeners to dirty?
    if (filteredDBNames.length > 0) {
      // We use bulk operations to get and then dirty/create ChangeListeners so that the listening
      // can be delegated to one of the ChangeListener processes.
      await this._changeListenersDirtyIfCleanOrLocked(filteredDBNames)
    }
  }

  // Separate out for easier unit testing
  _changes(opts) {
    return this._slouch.db.changes('_global_changes', opts)
  }

  async _setGlobal(name, value) {
    await this._globals.set(name, value)
  }

  async _saveLastSeq() {
    log.info('Saving lastSeq=', this._lastSeq)
    await this._setGlobal('lastSeq', this._lastSeq)
    this._seqLastSaved = new Date()
  }

  // We save the lastSeq every so often so that we can avoid having to re-process all the updates in
  // the event that an UpdateListener is restarted or a new one starts up
  async _saveLastSeqIfNeeded() {
    // Is it time to save the lastSeq again?
    if (new Date().getTime() - this._seqLastSaved.getTime() >= this._saveSeqAfterSeconds * 1000) {
      await this._saveLastSeq()
    }
  }

  _listenToIteratorErrors(iterator) {
    iterator.on('error', err => {
      this._onError(err)
    })
  }

  // Note: due to the resource leak described at https://github.com/apache/couchdb/issues/1063 the
  // following logic has been modified so that it does not abort the continuous listening for each
  // batch. This logic is in fact more efficient as it does not require a new request per batch.
  // Also, using longpoll doesn't really work here as longpoll returns empty data sets when nothing
  // changes.
  async _listenToUpdates() {
    this._dbUpdatesIterator = this._changes({
      feed: 'continuous',
      heartbeat: true,
      since: this._lastSeq ? this._lastSeq : undefined

      // Note: we no longer use the sieve view as views on the _global_changes database appear to be
      // flaky when there is a significant amount of activity. Specifically, changes will never be
      // reported by the _changes feed and this will result in replicators and change-listeners
      // never being dirted. This becomes clear when running the stress tests with 1,000
      // replicators.
      //
      // TODO: remove the sieve view?
      //
      // filter: '_view',
      // view: this._spiegel._namespace + 'sieve/sieve'
    })

    this._listenToIteratorErrors(this._dbUpdatesIterator)

    await this._dbUpdatesIteratorEach()
  }

  _logFatal(err) {
    log.fatal(err)
  }

  async _listen() {
    try {
      await this._listenToUpdates()
    } catch (err) {
      // Log fatal error here as this is in our listening loop, which is detached from our starting
      // chain of promises
      this._logFatal(err)
    }
  }

  _getLastSeq() {
    return this._globals.get('lastSeq')
  }

  async start() {
    this._lastSeq = await this._getLastSeq()

    // We haven't actually saved the lastSeq but we need to initialize the value here so that we
    // will save the updated value in the future
    this._seqLastSaved = new Date()

    this._listen()
  }

  async stop() {
    this._stopped = true
    if (this._dbUpdatesIterator) {
      this._dbUpdatesIterator.abort()
    }

    // Save the lastSeq so that we don't lose our place
    await this._saveLastSeq()
  }
}

module.exports = UpdateListeners
