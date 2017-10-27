'use strict'

const ChangeProcessor = require('../../src/change-processor')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('change-processor', () => {
  let changeProcessor
  let calls = null
  let params = { foo: 'bar' }
  let opts = { method: 'GET' }

  const spy = () => {
    calls = []
    testUtils.spy(
      changeProcessor,
      [
        '_debounce',
        '_request',
        '_makeDebouncedRequest',
        '_buildParams',
        '_getMethod',
        '_addPassword',
        '_setParams',
        '_makeDebouncedOrRegularRequest'
      ],
      calls
    )
  }

  const fake = () => {
    changeProcessor._req = sporks.resolveFactory()
  }

  beforeEach(async () => {
    changeProcessor = new ChangeProcessor(testUtils.spiegel)
    spy()
    fake()
  })

  const fakePasswords = () => {
    changeProcessor._passwordInjector._passwords = {
      'example.com': {
        user: 'password'
      }
    }
  }

  it('should build params', () => {
    let doc = {
      _id: '1',
      _rev: '1',
      thing: 'jam'
    }

    let change = {
      doc
    }

    let onChange = {
      params: {
        foo: 'bar',
        change: '$change',
        db_name: '$db_name'
      }
    }

    let params = changeProcessor._buildParams(change, onChange, 'test_db1')

    params.should.eql({
      foo: 'bar',
      change: change.doc,
      db_name: 'test_db1'
    })
  })

  it('should get method', () => {
    changeProcessor._getMethod({}).should.eql('GET')
    changeProcessor._getMethod({ method: 'get' }).should.eql('GET')
    changeProcessor._getMethod({ method: 'post' }).should.eql('POST')
    changeProcessor._getMethod({ method: 'POST' }).should.eql('POST')
  })

  it('should add password', () => {
    fakePasswords()
    changeProcessor
      ._addPassword('https://user@example.com/test_db1')
      .should.eql('https://user:password@example.com/test_db1')
  })

  it('should set params', () => {
    let params = { foo: 'bar' }

    let opts = {}
    changeProcessor._setParams('POST', opts, params)
    opts.should.eql({ json: params })

    opts = {}
    changeProcessor._setParams('DELETE', opts, params)
    opts.should.eql({ qs: params })

    opts = {}
    changeProcessor._setParams('GET', opts, params)
    opts.should.eql({ qs: params })
  })

  it('should _makeDebouncedRequest', async () => {
    await changeProcessor._makeDebouncedRequest(
      {
        url: 'https://example.com'
      },
      params,
      opts
    )

    calls._debounce[0][1].should.eql('https://example.com' + JSON.stringify(params))
    calls._request[0][0].should.eql(opts)
  })

  it('_makeDebouncedOrRegularRequest should make regular request', async () => {
    let onChange = {
      url: 'https://example.com'
    }

    await changeProcessor._makeDebouncedOrRegularRequest(onChange, params, opts)

    calls._makeDebouncedRequest.length.should.eql(0)
    calls._request[0][0].should.eql(opts)
  })

  it('_makeDebouncedOrRegularRequest should make debounced request', async () => {
    let onChange = {
      url: 'https://example.com',
      debounced: true
    }

    await changeProcessor._makeDebouncedOrRegularRequest(onChange, params, opts)

    calls._makeDebouncedRequest[0][0].should.eql(onChange)
    calls._makeDebouncedRequest[0][1].should.eql(params)
    calls._makeDebouncedRequest[0][2].should.eql(opts)
  })

  it('should _buildAndMakeRequest', async () => {
    fakePasswords()

    let doc = {
      _id: '1',
      _rev: '1',
      thing: 'jam'
    }

    let change = {
      doc
    }

    let onChange = {
      url: 'https://user@example.com/test_db1',
      params: {
        foo: 'bar',
        change: '$change',
        db_name: '$db_name'
      }
    }

    await changeProcessor._buildAndMakeRequest(change, onChange, 'test_db1')

    // Sanity tests
    calls._buildParams.length.should.eql(1)
    calls._getMethod.length.should.eql(1)
    calls._addPassword.length.should.eql(1)
    calls._setParams.length.should.eql(1)
    calls._makeDebouncedOrRegularRequest.length.should.eql(1)

    calls._request[0][0].should.eql({
      url: 'https://user:password@example.com/test_db1',
      method: 'GET',
      qs: {
        foo: 'bar',
        change: change.doc,
        db_name: 'test_db1'
      }
    })
  })
})
