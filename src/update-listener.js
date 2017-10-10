'use strict'

const Throttler = require('squadron').Throttler
const Globals = require('./globals')
const log = require('./log')

class UpdateListener {
  constructor (spiegel, opts) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch
    this._globals = new Globals(spiegel)

    this._throttler = new Throttler(
      opts && opts.maxConcurrentProcesses ? opts.maxConcurrentProcesses : undefined
    )

    this._lastSeq = null
  }

  allDone () {
    return this._throttler.allDone()
  }

  _onUpdate (update) {}

  _onError (err) {
    log.error(err)
  }

  _listen () {
    var self = this

    self._dbUpdatesIterator = self._slouch.db.changes('_global_changes', {
      feed: 'continuous',
      heartbeat: true,
      since: self._lastSeq,
      filter: '_view',
      view: self._spiegel._namespace + 'sieve/sieve'
    })

    self._dbUpdatesIterator.on('error', function (err) {
      self._onError(err)
    })

    self._dbUpdatesIterator.each(function (update) {
      self._onUpdate(update)
    })
  }

  async start () {
    this._lastSeq = await this._globals.get('lastSeq')
    this._listen()
  }

  stop () {
    this._dbUpdatesIterator.abort()
    return this.allDone()
  }
}

module.exports = UpdateListener
