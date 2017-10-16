'use strict'

const slouch = require('./slouch')
const UpdateListeners = require('./update-listeners')
const ChangeListeners = require('./change-listeners')
const Replicators = require('./replicators')
const OnChanges = require('./on-changes')

class Spiegel {
  constructor (opts) {
    this._slouch = slouch
    this._dbName = opts && opts.dbName ? opts.dbName : 'spiegel'

    // Used to create a separate namespace for testing
    this._namespace = opts && opts.namespace ? opts.namespace : ''

    this._updateListeners = new UpdateListeners(this, opts)
    this._changeListeners = new ChangeListeners(this)
    this._replicators = new Replicators(this)
    this._onChanges = new OnChanges(this)
  }

  async create () {
    await this._slouch.db.create(this._dbName)
    await this._slouch.security.onlyAdminCanView(this._dbName)
    await this._changeListeners.create()
    await this._onChanges.create()
    await this._replicators.create()
  }

  async destroy () {
    await this._changeListeners.destroy()
    await this._replicators.destroy()
    await this._onChanges.destroy()
    await this._slouch.db.destroy(this._dbName)
  }

  async start () {
    await this._updateListeners.start()
    // await this._changeListeners.start()
    await this._onChanges.start()
    // await this._replicators.start()
  }

  async stop () {
    await this._updateListeners.stop()
    // await this._changeListeners.stop()
    await this._onChanges.stop()
    // await this._replicators.stop()
  }
}

module.exports = Spiegel
