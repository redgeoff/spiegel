#!/usr/bin/env node

'use strict'

const fs = require('fs')
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

      const Spiegel = require('../src/spiegel')
      let spiegel = new Spiegel(argv.type, {
        dbName: argv['db-name'],
        namespace: argv['namespace']
      })
      await spiegel.installIfNotInstalled()
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
