'use strict';

// Note: we use promises for most of the functions below as we want the option to use another async
// cache in the future.

// const fs = require('fs-extra');

class Cache {
  constructor(path) {
    this._path = path;
    this._values = {};
  }

  set(name, value) {
    this._values[name] = value;
    return Promise.resolve();
  }

  get(name) {
    return Promise.resolve(this._values[name]);
  }
}

module.exports = Cache;
