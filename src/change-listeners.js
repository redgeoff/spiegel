'use strict'

class ChangeListeners {
  constructor (spiegel) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch

    // Separate namespace for change listener ids
    this._idPrefix = 'spiegel_cl_'
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

  _toId (dbName) {
    return this._idPrefix + dbName
  }

  _get (dbName) {
    return this._slouch.doc.getIgnoreMissing(this._spiegel._dbName, this._toId(dbName))
  }

  _upsert (listener) {
    return this._slouch.doc.upsert(this._spiegel._dbName, listener)
  }

  async dirtyIfClean (dbName) {
    let listener = await this._get(dbName)

    if (!listener) {
      // doc missing?
      listener = {
        // Prefix so that we can create a listener even when the id is reserved, e.g. _users
        _id: this._toId(dbName),

        db_name: dbName,
        type: 'change-listener'
      }
    }

    if (listener.dirty) {
      // Do nothing as listener is already dirty. This will happen often as 2 UpdateListener
      // processes will be trying to dirty the same listeners simultaenously as they are reading the
      // same updates
    } else {
      listener.dirty = true

      // Upsert a change as we want the listener to be considered dirty even if it was cleaned since
      // we got the doc.
      await this._upsert(listener)
    }
  }

  _updateLastSeq (id, lastSeq) {
    return this._slouch.doc.getMergeUpsert(this._spiegel._dbName, { _id: id, last_seq: lastSeq })
  }

  _clean (listener, lastSeq) {
    // Update listener and set last_seq and dirty=false. We must not ignore any errors from a
    // conflict as we want the routine that marks the monitor as dirty to always win so that we
    // prevent race conditions while setting the dirty status.
    listener.last_seq = lastSeq
    listener.dirty = false

    return this._slouch.doc.update(this._spiegel._dbName, listener)
  }

  async cleanOrUpdateLastSeq (listener, lastSeq) {
    try {
      await this._clean(listener, lastSeq)
    } catch (err) {
      if (err.error === 'conflict') {
        await this._updateLastSeq(listener._id, lastSeq)
      } else {
        throw err
      }
    }
  }

  // TODO:
  // onChanges () {}
}

module.exports = ChangeListeners
