'use strict'

class Replicators {
  constructor (spiegel) {
    this._spiegel = spiegel
    this._slouch = spiegel._slouch
  }

  _createDirtyReplicatorsView () {
    var doc = {
      _id: '_design/dirty_replicators',
      views: {
        dirty_replicators: {
          map: [
            'function(doc) {',
            'if (doc.type === "replicator" && doc.dirty) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  _createCleanOrLockedReplicatorsView () {
    var doc = {
      _id: '_design/clean_or_locked_replicators',
      views: {
        clean_replicators: {
          map: [
            'function(doc) {',
            'if (doc.type === "replicator" && (!doc.dirty || doc.locked_at)) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  // TODO: still needed or does clean_or_locked_replicators replace need for this view?
  _createCleanReplicatorsView () {
    var doc = {
      _id: '_design/clean_replicators',
      views: {
        clean_replicators: {
          map: [
            'function(doc) {',
            'if (doc.type === "replicator" && !doc.dirty) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  _createReplicatorsByDBNameView () {
    var doc = {
      _id: '_design/replicators_by_db_name',
      views: {
        replicators_by_db_name: {
          map: [
            'function(doc) {',
            'if (doc.type === "replicator") {',
            'emit(doc.db_name, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  async _createViews () {
    await this._createDirtyReplicatorsView()
    await this._createCleanOrLockedReplicatorsView()
    await this._createCleanReplicatorsView()
    return this._createReplicatorsByDBNameView()
  }

  create () {
    return this._createViews()
  }

  async _destroyViews () {
    await this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/dirty_replicators')
    await this._slouch.doc.getAndDestroy(
      this._spiegel._dbName,
      '_design/clean_or_locked_replicators'
    )
    await this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/clean_replicators')
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/replicators_by_db_name')
  }

  destroy () {
    return this._destroyViews()
  }
}

module.exports = Replicators
