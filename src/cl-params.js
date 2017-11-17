'use strict'

const sporks = require('sporks')
const fs = require('fs-extra')

class CLParams {
  constructor () {
    this._names = {
      common: { 'db-name': 'dbName', namespace: 'namespace', 'log-level': 'logLevel' },
      'update-listener': {
        'batch-size': 'batchSize',
        'batch-timeout': 'batchTimeout',
        'save-seq-after': 'saveSeqAfterSeconds'
      },
      'change-listener': {
        'batch-size': 'batchSize',
        concurrency: 'concurrency',
        'retry-after': 'retryAfterSeconds',
        'check-stalled': 'checkStalledSeconds',
        'passwords-file': 'passwords'
      },
      replicator: {
        concurrency: 'concurrency',
        'retry-after': 'retryAfterSeconds',
        'check-stalled': 'checkStalledSeconds',
        'passwords-file': 'passwords'
      }
    }

    this._opts = {
      common: {},
      'update-listener': {},
      'change-listener': {},
      replicator: {}
    }
  }

  _get (name, names) {
    let item = null

    sporks.each(names, (opts, type) => {
      sporks.each(opts, (optName, clName) => {
        if (name === clName) {
          item = {
            type: type,
            optName: optName
          }
        }

        if (item) {
          // Break loop
          return false
        }
      })

      if (item) {
        // Break loop
        return false
      }
    })

    return item
  }

  async _toOpt (type, name, value) {
    // Common names
    let names = { common: this._names.common }

    // Names specific to type
    if (this._names[type]) {
      names[type] = this._names[type]
    }

    let item = this._get(name, names)

    if (item) {
      if (name === 'passwords-file') {
        // Get JSON content from file
        value = await fs.readJson(value)
      }

      this._opts[item.type][item.optName] = value
    } else {
      throw new Error('invalid parameter ' + name)
    }
  }

  async toOpts (type, params) {
    let promises = []

    sporks.each(params, (value, name) => {
      promises.push(this._toOpt(type, name, value))
    })

    await Promise.all(promises)

    return this._opts
  }
}

module.exports = CLParams
