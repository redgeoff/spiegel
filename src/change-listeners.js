'use strict'

const sporks = require('sporks')
const Process = require('./process')
const ChangeProcessor = require('./change-processor')

class ChangeListeners extends Process {
  constructor (spiegel, opts) {
    super(
      spiegel,
      {
        passwords: opts && opts.passwords ? opts.passwords : undefined,
        retryAfterSeconds: opts && opts.retryAfterSeconds ? opts.retryAfterSeconds : undefined,
        maxConcurrentProcesses:
          opts && opts.maxConcurrentProcesses ? opts.maxConcurrentProcesses : undefined,
        stalledAfterSeconds: opts && opts.stalledAfterSeconds ? opts.stalledAfterSeconds : undefined
      },
      'change_listener'
    )

    // The max number of changes that will be processed in a batch
    this._batchSize = opts && opts.batchSize ? opts.batchSize : 100

    // Separate namespace for change listener ids
    this._idPrefix = 'spiegel_cl_'

    this._changeProcessor = new ChangeProcessor(spiegel, opts)
  }

  // TODO: still needed?
  _createDirtyListenersView () {
    var doc = {
      _id: '_design/dirty_listeners',
      views: {
        dirty_listeners: {
          map: [
            'function(doc) {',
            'if (doc.type === "change_listener" && doc.dirty) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  // TODO: remove as use listeners_by_db_name instead?
  _createCleanOrLockedListenersByNameView () {
    var doc = {
      _id: '_design/clean_or_locked_listeners_by_db_name',
      views: {
        clean_or_locked_listeners_by_db_name: {
          map: [
            'function(doc) {',
            'if (doc.type === "change_listener" && (!doc.dirty || doc.locked_at)) {',
            'emit(doc.db_name, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    }

    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, doc)
  }

  _createListenersByDBNameView () {
    var doc = {
      _id: '_design/listeners_by_db_name',
      views: {
        listeners_by_db_name: {
          map: [
            'function(doc) {',
            'if (doc.type === "change_listener") {',
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
    await super._createViews()
    await this._createDirtyListenersView()
    await this._createCleanOrLockedListenersByNameView()
    await this._createListenersByDBNameView()
  }

  async _destroyViews () {
    await super._destroyViews()
    await this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/dirty_listeners')
    await this._slouch.doc.getAndDestroy(
      this._spiegel._dbName,
      '_design/clean_or_locked_listeners_by_db_name'
    )
    await this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/listeners_by_db_name')
  }

  install () {
    return this._createViews()
  }

  destroy () {
    return this._destroyViews()
  }

  _toId (dbName) {
    return this._idPrefix + dbName
  }

  _getByDBName (dbName) {
    return this._slouch.doc.getIgnoreMissing(this._spiegel._dbName, this._toId(dbName))
  }

  // TODO: still needed?
  _upsert (listener) {
    return this._slouch.doc.upsert(this._spiegel._dbName, listener)
  }

  // TODO: remove as now handled by dirtyIfCleanOrLocked?
  async dirtyIfClean (dbName) {
    let listener = await this._getByDBName(dbName)

    if (!listener) {
      // doc missing?
      listener = {
        // Prefix so that we can create a listener even when the id is reserved, e.g. _users
        _id: this._toId(dbName),

        db_name: dbName,
        type: 'change_listener'
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
    // Use getMergeUpsert as we want the lastSeq to be stored even if there is a conflict from say
    // another process dirtying this ChangeListener
    return this._slouch.doc.getMergeUpsert(this._spiegel._dbName, { _id: id, last_seq: lastSeq })
  }

  // TODO: remove? Isn't this now handled by process layer?
  _cleanAndUnlock (listener, lastSeq) {
    // Update listener and set last_seq and dirty=false. We must not ignore any errors from a
    // conflict as we want the routine that marks the monitor as dirty to always win so that we
    // prevent race conditions while setting the dirty status.
    listener.last_seq = lastSeq
    listener.dirty = false

    // Release the lock
    delete listener.locked_at

    return this._update(listener)
  }

  // TODO: remove? Isn't this now handled by process layer?
  async cleanAndUnlockOrUpdateLastSeq (listener, lastSeq) {
    try {
      await this._cleanAndUnlock(listener, lastSeq)
    } catch (err) {
      if (err.error === 'conflict') {
        await this._updateLastSeq(listener._id, lastSeq)
      } else {
        throw err
      }
    }
  }

  async lock (listener) {
    // We use update instead of upsert as we want there to be a conflict as we only want one process
    // to hold the lock at any given time
    let lockedListener = sporks.clone(listener)
    lockedListener.locked_at = new Date().toISOString()
    this._setUpdatedAt(lockedListener)
    let response = await this._update(lockedListener)
    lockedListener._rev = response._rev
    return lockedListener
  }

  async _getByDBNames (dbNames) {
    let response = await this._slouch.db.viewArray(
      this._spiegel._dbName,
      '_design/listeners_by_db_name',
      'listeners_by_db_name',
      { include_docs: true, keys: JSON.stringify(dbNames) }
    )

    return response.rows.map(row => row.doc)
  }

  async _getCleanLockedOrMissing (dbNames) {
    let listeners = await this._getByDBNames(dbNames)

    // Index by dbName for quick retrieval
    let missing = sporks.flip(dbNames)

    let lists = []
    listeners.map(listener => {
      // Remove from missing
      delete missing[listener.db_name]

      // Clean or locked?
      if (!listener.dirty || listener.locked_at) {
        lists.push(listener)
      }
    })

    sporks.each(missing, (val, dbName) => {
      lists.push({
        db_name: dbName
      })
    })

    return lists
  }

  _dirtyOrCreate (listeners) {
    listeners.forEach(listener => {
      // Existing listener?
      if (listener._id) {
        listener.dirty = true
        this._setUpdatedAt(listener)
      } else {
        // Prefix so that we can create a listener even when the id is reserved, e.g. _users
        listener._id = this._toId(listener.db_name)
        listener.type = 'change_listener'
        listener.dirty = true
        this._setUpdatedAt(listener)
      }
    })

    return this._slouch.doc.bulkCreateOrUpdate(this._spiegel._dbName, listeners)
  }

  async _dirtyAndGetConflictedDBNames (listeners) {
    let response = await this._dirtyOrCreate(listeners)

    // Get a list of all the dbNames where we have conflicts. This can occur because the listener
    // was dirtied, locked or otherwise updated between the _getByDBNames() and _dirtyOrCreate()
    // calls.
    var conflictedDBNames = []
    response.forEach((doc, i) => {
      if (this._slouch.doc.isConflictError(doc)) {
        conflictedDBNames.push(listeners[i].db_name)
      }
    })

    return conflictedDBNames
  }

  async _attemptToDirtyIfCleanOrLocked (dbNames) {
    let listeners = await this._getCleanLockedOrMissing(dbNames)

    // length can be zero if there is nothing to dirty
    if (listeners.length > 0) {
      return this._dirtyAndGetConflictedDBNames(listeners)
    }
  }

  // We need to dirty ChangeListeners so that the listening can be delegated to a listener process.
  //
  // We use bulk operations as this is far faster than processing each ChangeListener individually.
  // With bulk operations we can take a batch of updates and in just a few requests to CouchDB
  // schedule the delegation and then move on to the next set of updates. In addition, processing
  // updates in a batch allows us to remove duplicates in that batch that often occur due to
  // back-to-back writes to a particular DB.
  //
  // When dirtying the ChangeListener we first get a list of all the ChangeListeners with matching
  // DB names. We then iterate through the results identifying clean or locked ChangeListeners and
  // any missing ChangeListeners. We need to include the locked ChangeListeners as we may already be
  // listening to a _changes feed, hence the lock, and we want to make sure to re-dirty the listener
  // so that the revision number changes. This will then result in the listener being retried later.
  // ChangeListeners are created when they are missing. A ChangeListeners's id is unique to the DB
  // name and this therefore prevents two UpdateListener processes from creating duplicate
  // ChangeListeners.
  //
  // Between the time the clean or locked ChangeListeners are retrieved and then dirtied, it is
  // possible that another UpdateListener dirties the same ChangeListener. In this event, we'll
  // detect the conflicts. We'll then retry the get and dirty for these conflicted ChangeListeners.
  // We'll repeat this process until there are no more conflicts.
  async dirtyIfCleanOrLocked (dbNames) {
    let conflictedDBNames = await this._attemptToDirtyIfCleanOrLocked(dbNames)
    if (conflictedDBNames && conflictedDBNames.length > 0) {
      return this.dirtyIfCleanOrLocked(conflictedDBNames)
    }
  }

  _processChange (change, dbName) {
    return this._changeProcessor.process(change, dbName)
  }

  _processChangeFactory (change, dbName) {
    return () => {
      return this._processChange(change, dbName)
    }
  }

  _slouchChangesArray (dbName, opts) {
    return this._slouch.db.changesArray(dbName, opts)
  }

  _changesArray (dbName, opts) {
    return this._slouchChangesArray(dbName, opts)
  }

  _changes (listener) {
    return this._changesArray(listener.db_name, {
      since: listener.last_seq || undefined,
      include_docs: true,
      limit: this._batchSize
    })
  }

  async _processChanges (listener, changes) {
    let chain = Promise.resolve()

    // Sequentially chain promises so that changes are processed in order and so that we don't
    // dominate the mem
    changes.results.forEach(change => {
      chain = chain.then(this._processChangeFactory(change, listener.db_name))
    })

    // Wait for all the changes to be processed
    await chain
  }

  _moreBatches (changes) {
    return !!changes.pending
  }

  async _processBatchOfChanges (listener) {
    let changes = this._changes(listener)

    await this._processChanges(listener, changes)

    // Save the lastSeq as we want our next batch to resume from where we left off
    await this._updateLastSeq(listener._id, changes.last_seq)

    // Are there more batches to process? If there are then we will leave this ChangeListener
    // dirty
    return this._moreBatches(changes)
  }

  async _processBatchOfChangesLogError (listener) {
    try {
      return this._processBatchOfChanges(listener)
    } catch (err) {
      // Log and emit error
      this._onError(err)

      // Leave the ChangeListener as dirty so that it will be retried
      return false
    }
  }

  _process (listener) {
    return this._processBatchOfChangesLogError(listener)
  }
}

module.exports = ChangeListeners
