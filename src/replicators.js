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

  _createCleanOrLockedReplicatorsByNameView () {
    var doc = {
      _id: '_design/clean_or_locked_replicators_by_db_name',
      views: {
        clean_or_locked_replicators_by_db_name: {
          // See _toDBName for how the DB name is extracted from the source
          map: [
            'function(doc) {',
            'if (doc.type === "replicator" && doc.source && (!doc.dirty || doc.locked_at)) {',
            'var i = doc.source.lastIndexOf("/");',
            'if (i !== -1) {',
            'emit(doc.source.substr(i + 1), null);',
            '}',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  // TODO: still needed or does clean_or_locked_replicators_by_db_name replace need for this view?
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
    await this._createCleanOrLockedReplicatorsByNameView()
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
      '_design/clean_or_locked_replicators_by_db_name'
    )
    await this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/clean_replicators')
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/replicators_by_db_name')
  }

  destroy () {
    return this._destroyViews()
  }

  async _getCleanOrLocked (dbNames) {
    let response = await this._slouch.db.viewArray(
      this._spiegel._dbName,
      '_design/clean_or_locked_replicators_by_db_name',
      'clean_or_locked_replicators_by_db_name',
      { include_docs: true, keys: JSON.stringify(dbNames) }
    )

    return response.rows.map(row => row.doc)
  }

  _dirty (replicators) {
    replicators.forEach(replicator => {
      replicator.dirty = true
    })

    return this._slouch.doc.bulkCreateOrUpdate(this._spiegel._dbName, replicators)
  }

  _toDBName (source) {
    if (source) {
      var i = source.lastIndexOf('/')
      if (i !== -1) {
        return source.substr(i + 1)
      }
    }
  }

  async _dirtyAndGetConflictedDBNames (replicators) {
    let response = await this._dirty(replicators)

    // Get a list of all the dbNames where we have conflicts. This can occur because the replicator
    // was dirtied, locked or otherwise updated between the _getCleanOrLocked() and _dirty() calls
    // above.
    var conflictedDBNames = []
    response.forEach((doc, i) => {
      if (this._slouch.doc.isConflictError(doc)) {
        conflictedDBNames.push(this._toDBName(replicators[i].source))
      }
    })

    return conflictedDBNames
  }

  async _attemptToDirtyIfCleanOrLocked (dbNames) {
    let replicators = await this._getCleanOrLocked(dbNames)

    // length can be zero if there is nothing to dirty
    if (replicators.length > 0) {
      return this._dirtyAndGetConflictedDBNames(replicators)
    }
  }

  // We need to dirty replicators so that the replication can be delegated to the replicator
  // process.
  //
  // We use bulk operations as this is far faster than processing each replicator individually. With
  // bulk operations we can take a batch of updates and in just a few requests to CouchDB schedule
  // the delegation and then move on to the next set of updates. In addition, processing updates in
  // a batch allows us to remove duplicates in that batch that often occur due to back-to-back
  // writes to a particular DB.
  //
  // When dirtying the replicators we first get a list of all the clean or locked replicators. We
  // need to include the locked replicators as we may already be performing a replication, hence the
  // lock, and we want to make sure to re-dirty the replicator so that the revision number changes.
  // This will then result in the replication being retried later.
  //
  // Between the time the clean or locked replicators are retrieved and then dirtied, it is possible
  // that another UpdateListener dirties the same replicator. In this event, we'll detect the
  // conflicts. We'll then retry the get and dirty for these conflicted replicators. We'll repeat
  // this process until there are no more conflicts.
  async dirtyIfCleanOrLocked (dbNames) {
    let conflictedDBNames = await this._attemptToDirtyIfCleanOrLocked(dbNames)
    if (conflictedDBNames && conflictedDBNames.length > 0) {
      return this.dirtyIfCleanOrLocked(conflictedDBNames)
    }
  }
}

module.exports = Replicators
