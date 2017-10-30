'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
chai.should()

const testUtils = require('./utils')

describe('spiegel', function () {
  // Extend the timeout as the DB needs more time to process changes
  this.timeout(testUtils.TIMEOUT)

  testUtils.silenceLog()

  before(() => {
    return testUtils.spiegel.install()
  })

  after(() => {
    return testUtils.spiegel.uninstall()
  })

  require('./spec')
  require('./integration')
})
