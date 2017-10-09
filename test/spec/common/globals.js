'use strict'

const Globals = require('../../../src/common/globals')
const Spiegel = require('../../../src/common/spiegel')

describe('globals', () => {
  let globals = new Globals(new Spiegel())

  it('should set & get', async () => {
    await globals.set('lastSeq', '123')
    let seq = await globals.get('lastSeq')
    seq.should.eql('123')
  })
})
