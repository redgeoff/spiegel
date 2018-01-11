'use strict'

const config = require('./config.json')
const { URL } = require('url')

class Utils {
  couchDBURL() {
    let u = new URL('http://example.com')
    u.protocol = config.couchdb.scheme
    u.hostname = config.couchdb.host
    u.port = config.couchdb.port
    u.username = config.couchdb.username
    u.password = config.couchdb.password

    // Remove trailing slash
    return u.href.replace(/\/$/, '')
  }

  setCouchDBConfig(couchDBURL) {
    let u = new URL(couchDBURL)
    config.couchdb.scheme = u.protocol
    config.couchdb.host = u.hostname
    config.couchdb.port = u.port
    config.couchdb.username = u.username
    config.couchdb.password = u.password
  }

  censorPasswordInURL(urlString) {
    let u = new URL(urlString)
    if (u.password) {
      u.password = '**********'
    }
    return u.href
  }

  getOpt(opts, name, def) {
    return opts && opts[name] !== undefined ? opts[name] : def
  }
}

module.exports = new Utils()
