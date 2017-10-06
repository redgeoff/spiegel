'use strict'

const Cache = require('../../../src/common/cache')

describe('cache', () => {
  let cache = new Cache()

  it('should set', async () => {
    await cache.set('foo', 'bar')
    const foo = await cache.get('foo')
    foo.should.eql('bar')
  })
})
