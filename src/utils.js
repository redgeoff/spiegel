'use strict'

const config = require('./config.json')
const { URL } = require('url')

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

  setCouchDBConfig (couchDBURL) {
    let u = new URL(couchDBURL)
    config.scheme = u.protocol
    config.host = u.hostname
    config.port = u.port
    config.username = u.username
    config.password = u.password
  }

  censorPasswordInURL (urlString) {
    let u = new URL(urlString)
    if (u.password) {
      u.password = '**********'
    }
    return u.href
  }

  getOpt (opts, name, def) {
    return opts && opts[name] !== undefined ? opts[name] : def
  }
}

module.exports = new Utils()
