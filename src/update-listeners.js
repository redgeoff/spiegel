'use strict'

const Globals = require('./globals')
const log = require('./log')

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

  // TODO: remove as no longer in design
  _onUpdate (update) {}

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

      if (i++ === 0) {
        // The 1st update can take any amount of time, but after it is read, we want to start a
        // timer. If the timer expires then we want to close the stream and consider the batch
        // collected. We pass in the iterator as by the time the timeout completes we have already
        // created a new _dbUpdatesIterator
        this._startBatchTimeout(this._dbUpdatesIterator)
      } else if (i === this._batchSize) {
        this._dbUpdatesIterator.abort()
      }
    })
  }

  _processNextBatch () {
    // TODO: use replicators and change-listeners
  }

  async _listenToNextBatch () {
    // Clear any previous batch of updates
    this._updatedDBs = []

    this._dbUpdatesIterator = this._slouch.db.changes('_global_changes', {
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
    await this._listenToNextBatch()

    // Make sure that nothing else is processed when we have stopped
    if (!this._stopped) {
      // We don't await here as we just want _listen to be called again and don't want to have to
      // waste memory chaining the promises
      this._listen()
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
