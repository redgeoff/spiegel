'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
chai.should()

const Spiegel = require('../src/common/spiegel')

describe('spiegel', () => {
  let spiegel = new Spiegel()

  before(() => {
    return spiegel.create()
  })

  after(() => {
    return spiegel.destroy()
  })

  require('./spec')
})
