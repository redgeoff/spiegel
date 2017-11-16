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

      let replicatorPasswords =
        argv.type === 'replicator' && argv['passwords-file']
          ? await fs.readJson(argv['passwords-file'])
          : undefined

      let changeListenerPasswords =
        argv.type === 'change-listener' && argv['passwords-file']
          ? await fs.readJson(argv['passwords-file'])
          : undefined

      const Spiegel = require('../src/spiegel')
      let spiegel = new Spiegel(argv.type, {
        dbName: argv['db-name'],
        namespace: argv['namespace'],
        logLevel: argv['log-level'],
        updateListener: {
          batchSize: argv['batch-size'],
          batchTimeout: argv['batch-timeout'],
          saveSeqAfterSeconds: argv['save-seq-after'],
          concurrency: argv['concurrency'],
          retryAfterSeconds: argv['retry-after'],
          checkStalledSeconds: argv['check-stalled']
        },
        changeListener: {
          passwords: changeListenerPasswords,
          batchSize: argv['batch-size'],
          concurrency: argv['concurrency'],
          retryAfterSeconds: argv['retry-after'],
          checkStalledSeconds: argv['check-stalled']
        },
        replicator: {
          passwords: replicatorPasswords
        }
      })
      // await spiegel.installIfNotInstalled()
      await spiegel.start()

      // Gracefully handle SIGINT signals
      process.on('SIGINT', async () => {
        log.info('Stopping as received SIGNINT')
        await spiegel.stop()
      })
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
