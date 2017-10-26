'use strict'

const Debouncer = require('squadron').Debouncer
const request = require('request')
const sporks = require('sporks')
const PasswordInjector = require('./password-injector')

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

    this._request = sporks.promisify(request)

    this._passwordInjector = new PasswordInjector(opts && opts.passwords)
  }

  _buildParams (change, onChange, dbName) {
    let params

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

  _makeDebouncedOrRegularRequest (change, onChange, dbName) {
    let params = this._buildParams(change, onChange, dbName)

    let method = onChange.method ? onChange.method.toUpperCase() : 'GET'

    let opts = {
      url: this._passwordInjector.addPassword(onChange.url),
      method: method
    }

    // Whether we use "qs" or "json" depends on the method
    if (method === 'DELETE' || method === 'GET') {
      opts.qs = params
    } else {
      opts.json = params
    }

    if (onChange.debounced) {
      // The resource depends on the URL and the params passed to the API
      let resource = onChange.url + JSON.stringify(params)

      return this._debouncer.run(() => {
        return this._request(opts)
      }, resource)
    } else {
      return this._request(opts)
    }
  }

  async _makeRequest (change, onChange, dbName) {
    // We don't await here as we only await below if the "block" option is being used
    let req = this._makeDebouncedOrRegularRequest(change, onChange, dbName)

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

  async process (change, dbName) {
    let onChanges = await this._spiegel.onChanges.getMatchingOnChanges(change)
    await this._makeRequests(change, onChanges, dbName)
  }
}

module.exports = ChangeProcessor
