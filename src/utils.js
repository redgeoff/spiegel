'use strict'

const config = require('./config.json')
const fs = require('fs')
const url = require('url')

class Utils {
  couchDBURL () {
    return (
      config.couchdb.scheme +
      '://' +
      config.couchdb.username +
      ':' +
      config.couchdb.password +
      '@' +
      config.couchdb.host +
      ':' +
      config.couchdb.port
    )
  }

  levelPath () {
    // As per https://github.com/Level/levelup/issues/222 on VirtualBox there are problems when the
    // directory uses mmap. As a workaround if we detect that we are running with vagrant then we'll
    // use a directory that is exclusive to the VM.
    if (fs.existsSync('/vagrant')) {
      return '/home/ubuntu'
    } else {
      return './cache'
    }
  }

  setCouchDBConfig (couchDBURL) {
    let u = url.parse(couchDBURL)
    config.scheme = u.protocol
    config.host = u.hostname
    config.port = u.port
    config.username = u.username
    config.password = u.password
  }
}

module.exports = new Utils()
