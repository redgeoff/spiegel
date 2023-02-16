'use strict'

const sporks = require('sporks')
const fs = require('fs-extra')

class CLParams {
  constructor() {
    this._names = {
      common: {
        type: 'type',
        url: 'url',
        'db-name': 'dbName',
        namespace: 'namespace',
        'log-level': 'logLevel'
      },
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
        'assume-deleted-after': 'assumeDeletedAfterSeconds',
        'passwords-file': 'passwords',
        'backoff-strategy': 'backoffStrategy',
        'backoff-multiplier': 'backoffMultiplier',
        'backoff-delay': 'backoffDelay',
        'backoff-limit': 'backoffLimit'
      },
      replicator: {
        concurrency: 'concurrency',
        'retry-after': 'retryAfterSeconds',
        'check-stalled': 'checkStalledSeconds',
        'assume-deleted-after': 'assumeDeletedAfterSeconds',
        'passwords-file': 'passwords'
      }
    }

    this._opts = {
      common: {},
      'update-listener': {},
      'change-listener': {},
      replicator: {}
    }

    // Default params injected by yargs
    this._ignoreNames = ['_', 'help', 'version', '$0']
  }

  _get(name, names) {
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

  async _toOpt(type, name, value) {
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

  _ignoreName(name) {
    // Ignore any names automatically created by yargs. Also ignore any names with a capital letter,
    // i.e. the camel case version of our param automatically injected by yargs.
    return this._ignoreNames.indexOf(name) !== -1 || /[A-Z]/.test(name)
  }

  async _toOpts(params) {
    let promises = []
    let type = params.type

    sporks.each(params, (value, name) => {
      if (!this._ignoreName(name)) {
        promises.push(this._toOpt(type, name, value))
      }
    })

    await Promise.all(promises)

    return this._opts
  }

  async toOpts(params) {
    // Move common into the root level options
    let opts = await this._toOpts(params)
    opts = sporks.merge(opts, opts.common)
    delete opts.common
    return opts
  }
}

module.exports = CLParams
