'use strict';

var Promise = require('sporks/scripts/promise');

var Foo = function () {
  this._thing = 'yar';
};

Foo.prototype.bar = function () {
  return Promise.resolve(this._thing);
};

module.exports = Foo;
