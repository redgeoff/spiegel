'use strict';

const Cache = require('../../../scripts/common/cache');

describe('cache', () => {

  let cache = new Cache( /* path */ );

  it('should set', async() => {
    await cache.set('foo', 'bar');
    const foo = await cache.get('foo');
    foo.should.eql('bar');
  });

});
