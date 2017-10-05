'use strict';

var chai = require('chai');
chai.use(require('chai-as-promised'));
chai.should();

var Foo = require('../scripts/foo');

require('./node-and-browser');

describe('browser', function () {

  it('should test in only the browser', function () {
    // TODO: insert tests that can only be tested in the browser
    var foo = new Foo();
    return foo.bar().then(function (thing) {
      thing.should.eql('yar');
    });
  });

});
