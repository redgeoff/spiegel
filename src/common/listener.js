'use strict'

class Listener {
  constructor (spiegel) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch
  }

  _createDirtyListenersView () {
    var doc = {
      _id: '_design/dirty_listeners',
      views: {
        dirty_listeners: {
          map: [
            'function(doc) {',
            'if (doc.type === "listener" && doc.dirty) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  _createViews () {
    return this._createDirtyListenersView()
  }

  _destroyViews () {
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/dirty_listeners')
  }

  create () {
    return this._createViews()
  }

  destroy () {
    return this._destroyViews()
  }
}

module.exports = Listener
