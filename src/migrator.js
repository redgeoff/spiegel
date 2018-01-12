'use strict'

const pkg = require('../package.json')

class Migrator {
  constructor(spiegel) {
    this._globals = spiegel._globals
  }

  async saveCurrentVersion() {
    await this._globals.set('version', pkg.version)
  }

  getSavedVersion() {
    return this._globals.get('version')
  }

  async migrate() {}
}

module.exports = Migrator
