'use strict'

const NAMESPACE = 'global_'

class Globals {
  constructor (spiegel) {
    this._spiegel = spiegel
    this._slouch = this._spiegel._slouch
  }

  _toId (name) {
    return NAMESPACE + name
  }

  set (name, value) {
    return this._slouch.doc.getMergeUpsert(this._spiegel._dbName, {
      _id: this._toId(name),
      type: 'global',
      value: value
    })
  }

  async get (name) {
    let doc = await this._slouch.doc.getIgnoreMissing(this._spiegel._dbName, this._toId(name))
    return doc ? doc.value : undefined
  }
}

module.exports = Globals
