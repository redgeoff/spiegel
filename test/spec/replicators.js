'use strict'

const Replicators = require('../../src/replicators')
const testUtils = require('../utils')

describe('replicators', () => {
  let replicators = null

  beforeEach(async () => {
    replicators = new Replicators(testUtils.spiegel)
  })

  it('should extract db name', function () {
    replicators._toDBName('http://example.com:5984/mydb').should.eql('mydb')

    // We don't really care about this case as we require the source to be a FQDN
    testUtils.shouldEqual(replicators._toDBName('mydb'), undefined)

    testUtils.shouldEqual(replicators._toDBName(''), undefined)

    testUtils.shouldEqual(replicators._toDBName(), undefined)
  })
})
