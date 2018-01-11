'use strict'

const url = require('url')

class PasswordInjector {
  constructor(passwords) {
    this._passwords = passwords
  }

  addPassword(urlString) {
    if (this._passwords) {
      let parts = url.parse(urlString)

      // Was a password defined?
      if (this._passwords[parts.hostname] && this._passwords[parts.hostname][parts.auth]) {
        let password = this._passwords[parts.hostname][parts.auth]
        return (
          parts.protocol + '//' + parts.auth + ':' + password + '@' + parts.host + parts.pathname
        )
      }
    }

    return urlString
  }
}

module.exports = PasswordInjector
