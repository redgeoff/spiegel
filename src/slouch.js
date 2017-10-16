'use strict'

const utils = require('./utils')
const Slouch = require('couch-slouch')

module.exports = new Slouch(utils.couchDBURL())
