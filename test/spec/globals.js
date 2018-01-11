'use strict'

const Globals = require('../../src/globals')
const testUtils = require('../utils')

describe('globals', () => {
  let globals = new Globals(testUtils.spiegel)

  it('should set & get', async() => {
    await globals.set('testGlobal', '123')
    let seq = await globals.get('testGlobal')
    seq.should.eql('123')
  })
})
