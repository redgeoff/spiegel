'use strict'

class OnChange {
  constructor (spiegel) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch
  }

  _createOnChangesView () {
    var doc = {
      _id: '_design/on_changes',
      views: {
        dirty_listeners: {
          map: [
            'function(doc) {',
            'if (doc.type === "on_change") {',
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
    return this._createOnChangesView()
  }

  _destroyViews () {
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/on_changes')
  }

  create () {
    return this._createViews()
  }

  destroy () {
    return this._destroyViews()
  }
}

module.exports = OnChange
