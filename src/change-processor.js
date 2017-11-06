'use strict'

const Debouncer = require('squadron').Debouncer
const request = require('request')
const sporks = require('sporks')
const PasswordInjector = require('./password-injector')
const log = require('./log')
const utils = require('./utils')

// Example:
// {
//   type: 'on_change',
//   db_name: '<reg-ex>', // Matches against a DB name
//   if: { // OnChange only applies if this condition is met
//     '<attr-1>': '<reg-ex>',
//     '<attr-2>': '<reg-ex>',
//     ...
//   },
//   url: '<api-url>', // e.g. https://user@api.example.com. Passwords maintained via
//                     // host_passwords config
//   params: { // Parameters passed to API call
//     foo: 'bar',
//     change: '$change'   // can use $change for change doc
//     db_name: '$db_name' // $db_name is the name of matching DB
//   },
//   method: '<POST|PUT|GET|DELETE>'
//   block: <true|false>, // API request must resolve before moving on
//   debounce: <true|false> // Duplicate API requests are ignored
// }

class ChangeProcessor {
  constructor (spiegel, opts) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch

    // Use to debounce requests for the same API endpoint with the same parameters so that we avoid
    // extra processing when similar changes occur back to back
    this._debouncer = new Debouncer()

    this._req = sporks.promisify(request)

    this._passwordInjector = new PasswordInjector(utils.getOpt(opts, 'passwords'))
  }

  _buildParams (change, onChange, dbName) {
    let params = {}

    if (onChange.params) {
      sporks.each(onChange.params, (value, name) => {
        switch (value) {
          case '$db_name':
            params[name] = dbName
            break

          case '$change':
            params[name] = change.doc
            break

          default:
            params[name] = value
        }
      })
    }

    return params
  }

  _getMethod (onChange) {
    return onChange.method ? onChange.method.toUpperCase() : 'GET'
  }

  _addPassword (url) {
    return this._passwordInjector.addPassword(url)
  }

  _setParams (method, opts, params) {
    // Whether we use "qs" or "json" depends on the method
    if (method === 'DELETE' || method === 'GET') {
      opts.qs = params
    } else {
      opts.json = params
    }
  }

  _debounce (promiseFactory, resource) {
    return this._debouncer.run(promiseFactory(), resource)
  }

  _request () {
    let opts = sporks.clone(arguments[0])
    if (opts.url) {
      opts.url = utils.censorPasswordInURL(opts.url)
    }
    log.info('Requesting ' + JSON.stringify(opts))

    return this._req.apply(this._req, arguments)
  }

  _makeDebouncedRequest (onChange, params, opts) {
    // The resource depends on the URL and the params passed to the API
    let resource = onChange.url + JSON.stringify(params)
    return this._debounce(() => {
      return this._request(opts)
    }, resource)
  }

  _makeDebouncedOrRegularRequest (onChange, params, opts) {
    if (onChange.debounced) {
      return this._makeDebouncedRequest(onChange, params, opts)
    } else {
      return this._request(opts)
    }
  }

  _buildAndMakeRequest (change, onChange, dbName) {
    let params = this._buildParams(change, onChange, dbName)

    let method = this._getMethod(onChange)

    let opts = {
      url: this._addPassword(onChange.url),
      method: method
    }

    this._setParams(method, opts, params)

    return this._makeDebouncedOrRegularRequest(onChange, params, opts)
  }

  async _makeRequest (change, onChange, dbName) {
    // We don't await here as we only await below if the "block" option is being used
    let req = this._buildAndMakeRequest(change, onChange, dbName)

    // Should we block until the next request?
    if (onChange.block) {
      await req
    }
  }

  async _makeRequests (change, onChanges, dbName) {
    let promises = []

    // Run OnChanges in parallel
    sporks.each(onChanges, onChange => {
      promises.push(this._makeRequest(change, onChange, dbName))
    })

    await Promise.all(promises)
  }

  _getMatchingOnChanges (dbName, change) {
    return this._spiegel._onChanges.getMatchingOnChanges(dbName, change.doc)
  }

  async process (change, dbName) {
    let onChanges = await this._getMatchingOnChanges(dbName, change)
    await this._makeRequests(change, onChanges, dbName)
  }
}

module.exports = ChangeProcessor
