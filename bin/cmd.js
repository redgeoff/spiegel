#!/usr/bin/env node

// TODO: move almost all logic in this file into a proper module so that it can be unit tested

'use strict'

// version=false as the default handling of the version param by yargs doesn't work with docker
const yargs = require('yargs').version(false)
const argv = yargs.argv
const utils = require('../src/utils')
const log = require('../src/log')
const CLParams = require('../src/cl-params')
const fs = require('fs-extra')

const clParams = new CLParams()

if (argv.version) {
  const pkg = require('../package.json')
  console.log(pkg.version)
} else if (!argv.type || !argv.url) {
  // Missing the required attributes?
  fs
    .createReadStream(__dirname + '/usage.txt')
    .on('close', function () {
      process.exit(1)
    })
    .pipe(process.stdout)
} else {
  const start = async () => {
    try {
      let opts = await clParams.toOpts(argv)

      // Set CouchDB config
      utils.setCouchDBConfig(opts.url)

      const Spiegel = require('../src/spiegel')
      let spiegel = new Spiegel(opts.type, opts)
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
