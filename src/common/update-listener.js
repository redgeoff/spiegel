'use strict'

const Throttler = require('squadron').Throttler

class UpdateListener {
  constructor (spiegel, opts) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch

    this._throttler = new Throttler(opts.maxConcurrentProcesses)

    // TODO - need to get from DB
    this._lastSeq = null
  }

  allDone () {
    return this._throttler.allDone()
  }

  _dbUpdates = function () {
    this._dbUpdatesIterator = this._slouch.db.changes('_global_changes', {
      feed: 'continuous',
      heartbeat: true,
      since: this._lastSeq,
      view: 'sieve'
    })
    return this._dbUpdatesIterator
  }
}

module.exports = UpdateListener
