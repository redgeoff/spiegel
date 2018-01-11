'use strict'

const PasswordInjector = require('../../src/password-injector')

describe('password-injector', () => {
  let injector = null

  beforeEach(() => {
    injector = new PasswordInjector()
  })

  it('should add passwords', function() {
    // Clear any passwords
    injector._passwords = null

    // Should be unchanged as there is no passwords mapping
    injector
      .addPassword('http://user1@example.com/mydb')
      .should.eql('http://user1@example.com/mydb')

    // Fake passwords
    injector._passwords = {
      'example.com': {
        user1: 'password1',
        user2: 'password2'
      },
      'google.com': {
        user1: 'password'
      }
    }

    injector
      .addPassword('http://user1@example.com/mydb')
      .should.eql('http://user1:password1@example.com/mydb')

    injector
      .addPassword('https://user2@example.com/mydb')
      .should.eql('https://user2:password2@example.com/mydb')

    injector
      .addPassword('https://user1@google.com/mydb')
      .should.eql('https://user1:password@google.com/mydb')

    injector
      .addPassword('https://usermissing@example.com/mydb')
      .should.eql('https://usermissing@example.com/mydb')

    injector
      .addPassword('https://usermissing@missing.com/mydb')
      .should.eql('https://usermissing@missing.com/mydb')
  })
})
