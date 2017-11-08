'use strict'

const bunyan = require('bunyan')
let log = bunyan.createLogger({ name: 'spiegel', src: true })

var origFatal = log.fatal

/* istanbul ignore next */
log.fatal = function () {
  origFatal.apply(this, arguments)

  // Exit as this is a fatal error
  process.exit(-1)
}

module.exports = log
