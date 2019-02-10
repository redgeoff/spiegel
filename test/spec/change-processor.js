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
  let seq = '123-xyz'
  let change = {
    seq,
    doc
  }
  let origReq = null
  let requests = null

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
    origReq = changeProcessor._req
    changeProcessor._req = async() => {
      // Add a little delay to simulate a request
      await sporks.timeout(10)
    }
  }

  const unfake = () => {
    changeProcessor._req = origReq
  }

  beforeEach(async() => {
    changeProcessor = new ChangeProcessor(testUtils.spiegel)
    spy()
    fake()
    requested = false
    requests = []
  })

  afterEach(async() => {
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
        foo: '{{bar}}',
        badvar: '$unknownvar',
        change: '${change}',
        nottokenized: '${db_name}-${seq}',
        changeid: '$change.id',
        changerev: '$change.rev',
        db_name: '$db_name',
        seq: '$seq'
      }
    }

    let params = changeProcessor._buildParams(change, onChange, 'test_db1')

    params.should.eql({
      foo: '{{bar}}',
      badvar: '$unknownvar',
      change: change.doc,
      nottokenized: '${db_name}-${seq}',
      changeid: change.doc._id,
      changerev: change.doc._rev,
      db_name: 'test_db1',
      seq: change.seq
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

  it('should build url parameters', () => {
    fakePasswords()
    let onChange = {
      /* eslint no-template-curly-in-string: "off" */
      url: 'https://user@example.com/mon_${db_name}/${seq}/${change.id}-${change.rev}'
    }

    let url = changeProcessor._addPassword(changeProcessor._buildUrl(change, onChange, 'test_db1'))

    url.should.eql(`https://user:password@example.com/mon_test_db1/${change.seq}/${
      change.doc._id}-${change.doc._rev}`)
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

  const makeDebouncedRequest = async() => {
    await changeProcessor._makeDebouncedRequest(
      {
        url: 'https://example.com'
      },
      params,
      opts,
      requests
    )
  }

  it('should _makeDebouncedRequest', async() => {
    await makeDebouncedRequest()
    calls._debounce[0][1].should.eql('https://example.com' + JSON.stringify(params))
    calls._request[0][0].should.eql(opts)
  })

  it('should debounce', async() => {
    // This seems like overkill and is testing some functionality that is also tested in squadron,
    // however without this test it is possible for a tiny bug to break the debouncer at the Spiegel
    // layer.
    await Promise.all([
      makeDebouncedRequest(),
      makeDebouncedRequest(),
      makeDebouncedRequest(),
      makeDebouncedRequest()
    ])

    // We expect only 2 API requests. The 1st one runs immediately, the 2nd one is queued and the
    // rest are ignored as these subsequent requests are made before the 2nd one is even started.
    calls._request.length.should.eql(2)
  })

  it('_makeDebouncedOrRegularRequest should make regular request', async() => {
    let onChange = {
      url: 'https://example.com'
    }

    await changeProcessor._makeDebouncedOrRegularRequest(onChange, params, opts, requests)

    calls._makeDebouncedRequest.length.should.eql(0)
    calls._request[0][0].should.eql(opts)
  })

  it('_makeDebouncedOrRegularRequest should make debounced request', async() => {
    let onChange = {
      url: 'https://example.com',
      debounce: true
    }

    await changeProcessor._makeDebouncedOrRegularRequest(onChange, params, opts)

    calls._makeDebouncedRequest[0][0].should.eql(onChange)
    calls._makeDebouncedRequest[0][1].should.eql(params)
    calls._makeDebouncedRequest[0][2].should.eql(opts)
  })

  it('should _buildAndMakeRequest', async() => {
    fakePasswords()

    let onChange = {
      url: 'https://user@example.com/foo',
      params: {
        foo: 'bar',
        change: '$change',
        db_name: '$db_name'
      }
    }

    await changeProcessor._buildAndMakeRequest(change, onChange, 'test_db1', requests)

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
    changeProcessor._request = async() => {
      // Wait a bit to simulate a long request
      await sporks.timeout(100)
      requested = true
    }
  }

  it('_makeRequest should not block', async() => {
    fakeLongRequest()
    await changeProcessor._makeRequest(null, {}, null, requests)

    // _makeRequest should have resolved before the request has finished
    requested.should.eql(false)
  })

  it('_makeRequest should block', async() => {
    fakeLongRequest()
    await changeProcessor._makeRequest(null, { block: true }, null, requests)

    // _makeRequest should have resolved after the request has finished
    requested.should.eql(true)
  })

  it('should _makeRequests', async() => {
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

    await changeProcessor._makeRequests(change, onChanges, dbName, requests)

    calls._makeRequest[0][0].should.eql(change)
    calls._makeRequest[0][1].should.eql(onChanges[0])
    calls._makeRequest[0][2].should.eql(dbName)
    calls._makeRequest[1][0].should.eql(change)
    calls._makeRequest[1][1].should.eql(onChanges[1])
    calls._makeRequest[1][2].should.eql(dbName)
  })

  it('should process', async() => {
    // Sanity check
    await changeProcessor._spiegel._onChanges.start()
    await changeProcessor.process(change, 'test_db1')
    calls._getMatchingOnChanges.length.should.eql(1)
    calls._makeRequests.length.should.eql(1)
  })

  it('should request', async() => {
    unfake()

    let response = await changeProcessor._request({
      url: 'http://user:secret@localhost:3000/foo'
    })

    response[0].body.should.eql('Hello World')
  })

  it('should request with follow of GET redirects', async() => {
    unfake()

    let response = await changeProcessor._request({
      url: 'http://user:secret@localhost:3000/redirect'
    })

    response[0].statusCode.should.eql(200)
  })

  it('should request with 2xx statusCodes', async() => {
    unfake()

    let response = await changeProcessor._request({
      url: 'http://user:secret@localhost:3000/new',
      method: 'PUT'
    })

    response[0].statusCode.should.eql(201)
  })

  it('should request and not follow non-GET redirects', async() => {
    unfake()

    let response = await changeProcessor._request({
      url: 'http://user:secret@localhost:3000/redirect',
      method: 'PUT'
    })

    response[0].statusCode.should.eql(307)
  })

  it('should follow non-GET redirects with followAllRedirects', async() => {
    unfake()

    let response = await changeProcessor._request({
      url: 'http://user:secret@localhost:3000/redirect',
      followAllRedirects: true,
      method: 'PUT'
    })

    response[0].statusCode.should.eql(201)
  })

  it('request should handle status codes', async() => {
    unfake()

    let err = null
    try {
      await changeProcessor._request({
        url: 'http://user:secret@localhost:3000/womp-womp'
      })
    } catch (_err) {
      err = _err
    }

    err.message.should.eql('Error')
  })

  it('should _requestAndPush', async() => {
    let promise = Promise.resolve()
    let requests = []

    // Fake
    changeProcessor._request = () => {
      return promise
    }

    changeProcessor._requestAndPush(null, requests).should.eql(promise)
    requests[0].should.eql(promise)
  })
})
