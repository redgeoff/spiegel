'use strict'

const Throttler = require('squadron').Throttler
const log = require('./log')
const sporks = require('sporks')
const events = require('events')

class Process extends events.EventEmitter {
  constructor (spiegel, opts, type) {
    super()

    this._spiegel = spiegel
    this._slouch = spiegel._slouch

    this._type = type

    this._throttler = new Throttler(
      opts && opts.maxConcurrentProcesses ? opts.maxConcurrentProcesses : undefined
    )

    this._passwords = opts && opts.passwords ? opts.passwords : {}

    // WARNING: retryAfterSeconds must be less than the maximum time it takes to perform the action
    // or else there can be concurrent actions for the same DB that will backup the queue and
    // continuously run
    this._retryAfterSeconds = opts && opts.retryAfterSeconds ? opts.retryAfterSeconds : 10800

    // It will take up to roughly stalledAfterSeconds + retryAfterSeconds before an action is
    // retried. Be careful not make stalledAfterSeconds too low though or else you'll waste a lot of
    // CPU cycles just checking for stalled processes.
    this._stalledAfterSeconds = opts && opts.stalledAfterSeconds ? opts.stalledAfterSeconds : 600
  }

  _createDirtyAndUnLockedView () {
    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, {
      _id: '_design/dirty_and_unlocked_' + this._type,
      views: {
        ['dirty_and_unlocked_' + this._type]: {
          map: [
            'function(doc) {',
            'if (doc.type === "' + this._type + '" && doc.dirty && !doc.locked_at) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    })
  }

  _createLockedView () {
    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, {
      _id: '_design/locked_' + this._type,
      views: {
        ['locked_' + this._type]: {
          map: [
            'function(doc) {',
            'if (doc.type === "' + this._type + '" && doc.locked_at) {',
            'emit(doc._id, null);',
            '}',
            '}'
          ].join(' ')
        }
      }
    })
  }

  async _createViews () {
    await this._createDirtyAndUnLockedView()
    await this._createLockedView()
  }

  async _destroyViews () {
    await this._slouch.doc.getAndDestroy(
      this._spiegel._dbName,
      '_design/dirty_and_unlocked_' + this._type
    )
    await this._slouch.doc.getAndDestroy(this._spiegel._dbName, '_design/locked_' + this._type)
  }

  _get (id) {
    return this._slouch.doc.get(this._spiegel._dbName, id)
  }

  _getAndDestroy (id) {
    return this._slouch.doc.getAndDestroy(this._spiegel._dbName, id)
  }

  // Useful for determining the last time a item was used
  _setUpdatedAt (item) {
    item.updated_at = new Date().toISOString()
  }

  // TODO: refactor and move to Slouch?
  async _getLastSeq () {
    let lastSeq = null
    await this._changes({
      limit: 1,
      descending: true,
      filter: '_view',
      view: 'dirty_and_unlocked_' + this._type + '/dirty_and_unlocked_' + this._type
    }).each(change => {
      lastSeq = change.seq
    })
    return lastSeq
  }

  _getMergeUpsert (item) {
    return this._slouch.doc.getMergeUpsert(this._spiegel._dbName, item)
  }

  _update (item) {
    return this._slouch.doc.update(this._spiegel._dbName, item)
  }

  async _updateItem (item, getMergeUpsert) {
    let lockedItem = sporks.clone(item)

    this._setUpdatedAt(lockedItem)

    let response = null

    if (getMergeUpsert) {
      response = await this._getMergeUpsert(lockedItem)
    } else {
      response = await this._update(lockedItem)
    }

    lockedItem._rev = response._rev
    return lockedItem
  }

  async _lock (item) {
    // We use an update instead of an upsert as we want there to be a conflict as we only want one
    // process to hold the lock at any given time
    let lockedItem = sporks.clone(item)
    lockedItem.locked_at = new Date().toISOString()
    return this._updateItem(lockedItem, false)
  }

  async _upsertUnlock (item) {
    // Use new doc with just the locked_at cleared as we only want to change the locked status
    let rep = { _id: item._id, locked_at: null }
    return this._updateItem(rep, true)
  }

  async _unlockAndClean (item, leaveDirty) {
    // Leave dirty? This can occur when we want to unlock without cleaning as we still have more
    // processing to do for this item
    if (!leaveDirty) {
      item.dirty = false
    }

    item.locked_at = null

    // We do not upsert as we want the clean to fail if the item has been updated
    return this._updateItem(item, false)
  }

  async _unlock (item) {
    // We do not upsert as we want the unlock to fail if the item has been updated
    item.locked_at = null
    return this._updateItem(item, false)
  }

  async _lockAndThrowIfErrorAndNotConflict (item) {
    try {
      let rep = await this._lock(item)

      // Set the updated rev as we need to be able to unlock the replicator later
      item._rev = rep._rev
    } catch (err) {
      if (this._slouch.doc.isConflictError(err)) {
        log.trace('Ignoring common conflict', err)
        return true
      } else {
        throw err
      }
    }
  }

  _process () {
    // Abstract method to be implemented by derived class
  }

  async _processAndUnlockIfError (item) {
    try {
      return await this._process(item)
    } catch (err) {
      // If an error is encountered when processing then leave the item dirty, but unlock it so that
      // the processing can be tried again
      await this._upsertUnlock(item)
      throw err
    }
  }

  async _unlockAndCleanIfConflictJustUnlock (item, leaveDirty) {
    try {
      await this._unlockAndClean(item, leaveDirty)
    } catch (err) {
      if (this._slouch.doc.isConflictError(err)) {
        // A conflict can occur because an UpdateListener may have re-dirtied this item. When this
        // happens we need to leave the item dirty and unlock it so that the item can be retried
        log.trace('Ignoring common conflict', err)
        await this._upsertUnlock(item)
      } else {
        throw err
      }
    }
  }

  async _lockProcessUnlock (item) {
    // Lock and if conflict then ignore error as conflicts are expected when another item
    // process locks the same item
    let conflict = await this._lockAndThrowIfErrorAndNotConflict(item)
    if (!conflict) {
      // Attempt to process and if there is an error then it is thrown and logged below
      let leaveDirty = await this._processAndUnlockIfError(item)

      // Attempt to unlock and clean the item. If there is a conflict, which can occur when an
      // UpdateListener re-dirties the item then just unlock the item so that it can be retried
      await this._unlockAndCleanIfConflictJustUnlock(item, leaveDirty)
    }
  }

  async _onError (err) {
    log.error(err)

    // The event name cannot be "error" or else it will conflict with other error handler logic
    this.emit('err', err)
  }

  async _lockProcessUnlockLogError (replicator) {
    try {
      await this._lockProcessUnlock(replicator)
    } catch (err) {
      // Swallow the error as the item will be retried. We want to just log the error and then
      // swallow it so that the caller continues processing
      this._onError(err)
    }
  }

  async _processAllDirtyAndUnlocked () {
    let iterator = this._slouch.db.view(
      this._spiegel._dbName,
      '_design/dirty_and_unlocked_' + this._type,
      'dirty_and_unlocked_' + this._type,
      { include_docs: true }
    )

    await iterator.each(item => {
      return this._lockProcessUnlockLogError(item.doc)
    }, this._throttler)
  }

  _changes (params) {
    return this._slouch.db.changes(this._spiegel._dbName, params)
  }

  // Note: the changes feed with respect to the dirty_and_unlocked view will only get changes for
  // unlocked items. i.e. an item can be re-dirtied many times while it is processing, but it will
  // only be scheduled for processing (and scheduled once) when the item is unlocked
  async _listen (lastSeq) {
    this._iterator = this._changes({
      feed: 'continuous',
      heartbeat: true,
      since: lastSeq || undefined,
      filter: '_view',
      view: 'dirty_and_unlocked_' + this._type + '/dirty_and_unlocked_' + this._type,
      include_docs: true
    })

    this._iterator.on('error', err => {
      // Unexpected error. Errors should be handled at the Slouch layer and connections should be
      // persistent
      this._onError(err)
    })

    this._iterator.each(replicator => {
      return this._lockProcessUnlockLogError(replicator.doc)
    }, this._throttler)
  }

  async start () {
    // Get the last seq so that we can use this as the starting point when listening for changes
    let lastSeq = await this._getLastSeq()

    // Get all dirty items and then process the items
    await this._processAllDirtyAndUnlocked()

    // Listen for changes. We don't await here as the listening is a continuous operation
    this._listen(lastSeq)

    this._startUnstaller()
  }

  async stop () {
    this._stopUnstaller()

    if (this._iterator) {
      this._iterator.abort()
    }

    if (this._throttler) {
      await this._throttler.allDone()
    }
  }

  _lockedItems () {
    return this._slouch.db.view(
      this._spiegel._dbName,
      '_design/locked_' + this._type,
      'locked_' + this._type,
      { include_docs: true }
    )
  }

  _hasStalled (item) {
    // A item can stall if an item is started and then the associated process crashes or is
    // terminated abruptly.
    return (
      new Date().getTime() - new Date(item.locked_at).getTime() > this._retryAfterSeconds * 1000
    )
  }

  async _unlockStalled () {
    // Note: we cannot use a view to automatically track stalled processes as views with time
    // sensitive data like the current timestamp don't work as they are not refreshed as the
    // timestamp changes and if they were you'd loose the performance benefit of a view. Therefore,
    // we must iterate through all locked items. Fortunately, there should be a relatively small set
    // of locked items at any given time.
    let iterator = this._lockedItems()
    await iterator.each(async item => {
      if (this._hasStalled(item.doc)) {
        try {
          await this._unlock(item.doc)
        } catch (err) {
          // We can expect to get a conflict if two processes attempt to unlock the same stalled
          // item. We also want to prevent a process from unlocking an item, locking for a new
          // processing and having another process unlock the locked item.
          if (!this._slouch.doc.isConflictError(err)) {
            // Unexpected error
            throw err
          }
        }
      }
    })
  }

  _startUnstaller () {
    this._unstaller = setInterval(async () => {
      try {
        await this._unlockStalled()
      } catch (err) {
        // Unknown error
        this._onError(err)
      }
    }, this._stalledAfterSeconds * 1000)
  }

  _stopUnstaller () {
    clearInterval(this._unstaller)
  }
}

module.exports = Process
