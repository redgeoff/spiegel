#!/usr/bin/env node

// TODO: move almost all logic in this file into a proper module so that it can be unit tested

'use strict'

const fs = require('fs-extra')
const argv = require('yargs').argv
const utils = require('../src/utils')
const log = require('../src/log')

// Missing the required attributes?
if (!argv.type || !argv.url) {
  fs
    .createReadStream(__dirname + '/usage.txt')
    .on('close', function () {
      process.exit(1)
    })
    .pipe(process.stdout)
} else {
  const start = async () => {
    try {
      // Set CouchDB config
      utils.setCouchDBConfig(argv.url)

      let replicatorPasswords = argv['replicator-passwords']
        ? await fs.readJson(argv['replicator-passwords'])
        : undefined

      let changeListenerPasswords = argv['change-listener-passwords']
        ? await fs.readJson(argv['change-listener-passwords'])
        : undefined

      const Spiegel = require('../src/spiegel')
      let spiegel = new Spiegel(argv.type, {
        dbName: argv['db-name'],
        namespace: argv['namespace'],
        logLevel: argv['log-level'],
        replicator: {
          passwords: replicatorPasswords
        },
        changeListener: {
          passwords: changeListenerPasswords
        }
      })
      // await spiegel.installIfNotInstalled()
      await spiegel.start()
    } catch (err) {
      try {
        await spiegel.stop()
      } catch (err) {
        log.error('failed to stop')
      }
      log.fatal(err)
    }
  }
  start()
}
