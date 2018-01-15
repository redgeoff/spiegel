'use strict'

const Spiegel = require('../../src/spiegel')
const sporks = require('sporks')
const utils = require('../../src/utils')
const path = require('path')

class Runner {
  constructor() {
    // Prevent race conditions on the same DB
    let time = new Date().getTime()

    this._dbName = 'test_spiegel_integration' + time
    this._namespace = 'test_spiegel_integration_' + time + '_'
    this._url = utils.couchDBURL()

    this._updateListeners = []
    this._changeListeners = []
    this._replicators = []
    this._replicas = 2
  }

  _newSpiegel(type, opts) {
    return new Spiegel(
      type,
      sporks.merge(
        {
          dbName: this._dbName,
          namespace: this._namespace,
          url: this._url,
          logLevel: 'error'
        },
        opts
      )
    )
  }

  async _install() {
    await this._newSpiegel('install').start()
  }

  _createUpdateListener() {
    return this._newSpiegel('update-listener')
  }

  _createUpdateListeners() {
    for (let i = 0; i < this._replicas; i++) {
      this._updateListeners.push(this._createUpdateListener())
    }
  }

  async _startUpdateListeners() {
    await Promise.all(this._updateListeners.map(updateListener => updateListener.start()))
  }

  async _stopUpdateListeners() {
    await Promise.all(this._updateListeners.map(updateListener => updateListener.stop()))
  }

  _createChangeListener() {
    return this._newSpiegel('change-listener', {
      'change-listener': {
        passwords: path.join(__dirname, '/change-listener-passwords.json')
      }
    })
  }

  _createChangeListeners() {
    for (let i = 0; i < this._replicas; i++) {
      this._changeListeners.push(this._createChangeListener())
    }
  }

  async _startChangeListeners() {
    await Promise.all(this._changeListeners.map(changeListener => changeListener.start()))
  }

  async _stopChangeListeners() {
    await Promise.all(this._changeListeners.map(changeListener => changeListener.stop()))
  }

  _createReplicator() {
    return this._newSpiegel('replicator', {
      replicator: { passwords: path.join(__dirname, '/replicator-passwords.json') }
    })
  }

  _createReplicators() {
    for (let i = 0; i < this._replicas; i++) {
      this._replicators.push(this._createReplicator())
    }
  }

  async _startReplicators() {
    await Promise.all(this._replicators.map(replicator => replicator.start()))
  }

  async _stopReplicators() {
    await Promise.all(this._replicators.map(replicator => replicator.stop()))
  }

  async _uninstall() {
    await this._newSpiegel('uninstall').start()
  }

  async start() {
    await this._install()
    await this._createUpdateListeners()
    await this._startUpdateListeners()
    await this._createChangeListeners()
    await this._startChangeListeners()
    await this._createReplicators()
    await this._startReplicators()
  }

  async stop() {
    await this._stopUpdateListeners()
    await this._stopChangeListeners()
    await this._stopReplicators()
    await this._uninstall()
  }
}

module.exports = Runner
