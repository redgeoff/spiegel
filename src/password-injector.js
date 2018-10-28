'use strict'

const { URL } = require('url')

class PasswordInjector {
  constructor(passwords) {
    this._passwords = passwords
  }

  addPassword(urlString) {
    if (this._passwords) {
      let parts = new URL(urlString)

      // Was a password defined?
      if (this._passwords[parts.hostname] && this._passwords[parts.hostname][parts.username]) {
        let password = this._passwords[parts.hostname][parts.username]
        return (
          parts.protocol +
          '//' +
          parts.username +
          ':' +
          password +
          '@' +
          parts.host +
          parts.pathname
        )
      }
    }

    return urlString
  }
}

module.exports = PasswordInjector
