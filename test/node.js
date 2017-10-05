'use strict';

var chai = require('chai');
chai.use(require('chai-as-promised'));
chai.should();

var Foo = require('../scripts/foo');

require('./node-and-browser');

describe('node', function () {

  it('should test only in node', function () {
    // TODO: insert tests that can only be tested in node
    var foo = new Foo();
    return foo.bar().then(function (thing) {
      thing.should.eql('yar');
    });
  });

});
