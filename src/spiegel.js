'use strict'

const slouch = require('./slouch')
const ChangeListener = require('./change-listener')
const Replicator = require('./replicator')
const OnChange = require('./on-change')

class Spiegel {
  constructor (opts) {
    this._slouch = slouch
    this._dbName = opts && opts.dbName ? opts.dbName : 'spiegel'

    // Used to create a separate namespace for testing
    this._namespace = opts && opts.namespace ? opts.namespace : ''

    this._changeListener = new ChangeListener(this)
    this._replicator = new Replicator(this)
    this._onChange = new OnChange(this)
  }

  async create () {
    await this._slouch.db.create(this._dbName)
    await this._slouch.security.onlyAdminCanView(this._dbName)
    await this._changeListener.create()
    await this._onChange.create()
    await this._replicator.create()
  }

  async destroy () {
    await this._changeListener.destroy()
    await this._replicator.destroy()
    await this._onChange.destroy()
    await this._slouch.db.destroy(this._dbName)
  }
}

module.exports = Spiegel
