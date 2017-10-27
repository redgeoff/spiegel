'use strict'

const ChangeProcessor = require('../../src/change-processor')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('change-processor', () => {
  let changeProcessor
  let calls = null
  let params = { foo: 'bar' }
  let opts = { method: 'GET' }
  let requested = false
  let doc = {
    _id: '1',
    _rev: '1',
    thing: 'jam'
  }
  let change = {
    doc
  }

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
        '_makeDebouncedOrRegularRequest',
        '_makeRequest',
        '_getMatchingOnChanges',
        '_makeRequests'
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
    requested = false
  })

  afterEach(async () => {
    if (changeProcessor._spiegel._onChanges.isRunning()) {
      await changeProcessor._spiegel._onChanges.stop()
    }
  })

  const fakePasswords = () => {
    changeProcessor._passwordInjector._passwords = {
      'example.com': {
        user: 'password'
      }
    }
  }

  it('should build params', () => {
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
      ._addPassword('https://user@example.com/foo')
      .should.eql('https://user:password@example.com/foo')
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

    let onChange = {
      url: 'https://user@example.com/foo',
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
      url: 'https://user:password@example.com/foo',
      method: 'GET',
      qs: {
        foo: 'bar',
        change: change.doc,
        db_name: 'test_db1'
      }
    })
  })

  const fakeLongRequest = () => {
    changeProcessor._request = async () => {
      // Wait a bit to simulate a long request
      await sporks.timeout(100)
      requested = true
    }
  }

  it('_makeRequest should not block', async () => {
    fakeLongRequest()
    await changeProcessor._makeRequest(null, {})

    // _makeRequest should have resolved before the request has finished
    requested.should.eql(false)
  })

  it('_makeRequest should block', async () => {
    fakeLongRequest()
    await changeProcessor._makeRequest(null, { block: true })

    // _makeRequest should have resolved after the request has finished
    requested.should.eql(true)
  })

  it('should _makeRequests', async () => {
    let onChanges = [
      {
        url: 'https://user@example.com/foo',
        params: {
          foo: 'bar'
        }
      },
      {
        url: 'https://user@example.com/foo',
        params: {
          foo: 'bar2'
        }
      }
    ]

    let dbName = 'test_db1'

    await changeProcessor._makeRequests(change, onChanges, dbName)

    calls._makeRequest[0][0].should.eql(change)
    calls._makeRequest[0][1].should.eql(onChanges[0])
    calls._makeRequest[0][2].should.eql(dbName)
    calls._makeRequest[1][0].should.eql(change)
    calls._makeRequest[1][1].should.eql(onChanges[1])
    calls._makeRequest[1][2].should.eql(dbName)
  })

  it('should process', async () => {
    // Sanity check
    await changeProcessor._spiegel._onChanges.start()
    await changeProcessor.process(change, 'test_db1')
    calls._getMatchingOnChanges.length.should.eql(1)
    calls._makeRequests.length.should.eql(1)
  })
})
