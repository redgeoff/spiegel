'use strict'

const bunyan = require('bunyan')
let log = bunyan.createLogger({ name: 'spiegel', src: true })

module.exports = log
