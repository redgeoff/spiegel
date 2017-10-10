'use strict'

const slouch = require('./slouch')
const ChangeListener = require('./change-listener')
const Replicator = require('./replicator')

class Spiegel {
  constructor (opts) {
    this._slouch = slouch
    this._dbName = opts && opts.dbName ? opts.dbName : 'spiegel'

    // Used to create a separate namespace for testing
    this._namespace = opts && opts.namespace ? opts.namespace : ''

    this._changeListener = new ChangeListener(this)
    this._replicator = new Replicator(this)
  }

  async create () {
    await this._slouch.db.create(this._dbName)
    await this._slouch.security.onlyAdminCanView(this._dbName)
    await this._changeListener.create()
    return this._replicator.create()
  }

  async destroy () {
    await this._changeListener.destroy()
    await this._replicator.destroy()
    return this._slouch.db.destroy(this._dbName)
  }
}

module.exports = Spiegel
