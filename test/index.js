'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
chai.should()

const testUtils = require('./utils')
const server = require('./api-server')

describe('spiegel', function() {
  // Extend the timeout as the DB needs more time to process changes
  this.timeout(testUtils.TIMEOUT)

  testUtils.silenceLog()

  before(async() => {
    await testUtils.spiegel.install()
    await server.start()
  })

  after(async() => {
    await server.stop()
    await testUtils.spiegel.uninstall()
  })

  require('./spec')
  require('./integration')
})
