'use strict'

class ChangeListener {
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

  // TODO:
  // onChanges () {} // QUESTION: is it work creating some sort of cache so that don't have to hit DB each time? Probably, but then would need to listen for changes to on_change docs

  // TODO:
  // - Use async await
  // - Need locked construct
  // _setDirty (dbName) {
  //   var self = this
  //
  //   // Get any existing monitor doc
  //   return self._slouch.doc
  //     .getIgnoreMissing(self._dbName(), self.idPrefix + dbName)
  //     .then(function (monitor) {
  //       if (!monitor) {
  //         // doc missing?
  //         monitor = {
  //           // Prefix so that we can create a monitor even when the id is reserved, e.g. _users
  //           _id: self.idPrefix + dbName,
  //
  //           db: dbName,
  //           type: 'monitor' // use 'monitor' as we may introduce 'replicator' in the future
  //         }
  //       }
  //
  //       // Mark as dirty
  //       monitor.dirty = true
  //
  //       // Upsert a change as we want the monitor to be considered dirty even if it was cleaned since we
  //       // got the doc.
  //       return self._slouch.doc.upsert(self._dbName(), monitor)
  //     })
  //     .then(function () {
  //       return self._startMonitoringIfRunning()
  //     })
  // }
}

module.exports = ChangeListener
