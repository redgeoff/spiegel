'use strict';

var Foo = require('../scripts/foo');

describe('node and browser', function () {

  it('should test in both node and the browser', function () {
    // TODO: insert tests that can be tested in both node and the browser
    var foo = new Foo();
    return foo.bar().then(function (thing) {
      thing.should.eql('yar');
    });
  });

});
