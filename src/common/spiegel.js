'use strict'

const slouch = require('./slouch')
const Listener = require('./listener')
const Replicator = require('./replicator')

class Spiegel {
  constructor (opts) {
    this._slouch = slouch
    this._dbName = opts && opts.dbName ? opts.dbName : 'spiegel'
    this._listener = new Listener(this)
    this._replicator = new Replicator(this)
  }

  async create () {
    await this._slouch.db.create(this._dbName)
    await this._slouch.security.onlyAdminCanView(this._dbName)
    await this._listener.create()
    return this._replicator.create()
  }

  async destroy () {
    await this._listener.destroy()
    await this._replicator.destroy()
    return this._slouch.db.destroy(this._dbName)
  }
}

module.exports = Spiegel
