'use strict'

const sporks = require('sporks')

class CLParams {
  constructor () {
    this._names = {
      common: { 'db-name': 'dbName', namespace: 'namespace', 'log-level': 'logLevel' },
      'update-listener': {
        'batch-size': 'batchSize',
        'batch-timeout': 'batchTimeout',
        'save-seq-after': 'saveSeqAfterSeconds',
        concurrency: 'concurrency',
        'check-stalled': 'checkStalledSeconds'
      },
      'change-listener': {
        'batch-size': 'batchSize',
        concurrency: 'concurrency',
        'retry-after': 'retryAfterSeconds',
        'check-stalled': 'checkStalledSeconds',
        'passwords-file': 'passwords'
      },
      replicator: { 'retry-after': 'retryAfterSeconds', 'passwords-file': 'passwords' }
    }

    this._opts = {
      common: {},
      'update-listener': {},
      'change-listener': {},
      replicator: {}
    }
  }

  _toOpt (type, name, value) {
    let found = false

    // Common names
    let names = { common: this._names.common }

    // Names specific to type
    if (this._names[type]) {
      names[type] = this._names[type]
    }

    sporks.each(names, (opts, proc) => {
      sporks.each(opts, (optName, clName) => {
        if (name === clName) {
          found = true

          // TODO: passwords-files

          this._opts[proc][optName] = value
        }

        if (found) {
          // Break loop
          return false
        }
      })

      if (found) {
        // Break loop
        return false
      }
    })

    if (!found) {
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
