'use strict'

const log = require('./log')
const sporks = require('sporks')
const Process = require('./process')
const PasswordInjector = require('./password-injector')
const utils = require('./utils')

class Replicators extends Process {
  constructor(spiegel, opts) {
    super(
      spiegel,
      {
        passwords: utils.getOpt(opts, 'passwords'),
        retryAfterSeconds: utils.getOpt(opts, 'retryAfterSeconds'),
        concurrency: utils.getOpt(opts, 'concurrency'),
        checkStalledSeconds: utils.getOpt(opts, 'checkStalledSeconds')
      },
      'replicator'
    )

    // "continuous" is added here as we do not want the continuous parameter to be passed to CouchDB
    // or else the replication will block indefinitely. "cancel" is needed as it does not apply and
    // would lead to unintended behavior
    this._spiegelReplicationParams = [
      'type',
      'dirty',
      'locked_at',
      'updated_at',
      'continuous',
      'cancel'
    ]

    this._passwordInjector = new PasswordInjector(this._passwords)
  }

  _createCleanOrLockedReplicatorsByDBNameView() {
    return this._slouch.doc.createOrUpdate(this._spiegel._dbName, {
      _id: '_design/clean_or_locked_replicators_by_db_name',
      views: {
        clean_or_locked_replicators_by_db_name: {
          // See _toDBName for how the DB name is extracted from the source
          map: [
            'function(doc) {',
            'if (doc.type === "replicator" && doc.source &&' +
              ' ((!doc.dirty && !doc.dirty_at) || doc.locked_at)) {',
            'var i = doc.source.lastIndexOf("/");',
            'if (i !== -1) {',
            'emit(doc.source.substr(i + 1), null);',
            '}',
            '}',
            '}'
          ].join(' ')
        }
      }
    })
  }

  async _createViews() {
    await super._createViews()
    await this._createCleanOrLockedReplicatorsByDBNameView()
  }

  install() {
    return this._createViews()
  }

  async _destroyViews() {
    await super._destroyViews()
    await this._slouch.doc.getAndDestroy(
      this._spiegel._dbName,
      '_design/clean_or_locked_replicators_by_db_name'
    )
  }

  uninstall() {
    return this._destroyViews()
  }

  async _getCleanOrLocked(dbNames) {
    let response = await this._slouch.db.viewArray(
      this._spiegel._dbName,
      '_design/clean_or_locked_replicators_by_db_name',
      'clean_or_locked_replicators_by_db_name',
      { include_docs: true, keys: JSON.stringify(dbNames) }
    )

    return response.rows.map(row => row.doc)
  }

  _dirty(replicators, dirtyDate) {
    replicators.forEach(replicator => {
      if (replicator.dirty_after_milliseconds > 0) {
        let dirtyTime = new Date(
          dirtyDate.getTime() + replicator.dirty_after_milliseconds
        ).toISOString()
        this._setDirtyAt(replicator, dirtyTime)
      } else {
        this._setDirty(replicator)
      }
      this._setUpdatedAt(replicator)
    })

    return this._slouch.doc.bulkCreateOrUpdate(this._spiegel._dbName, replicators)
  }

  _toDBName(source) {
    if (source) {
      var i = source.lastIndexOf('/')
      if (i !== -1) {
        return source.substr(i + 1)
      }
    }
  }

  async _dirtyAndGetConflictedDBNames(replicators, dirtyDate) {
    let response = await this._dirty(replicators, dirtyDate)

    // Get a list of all the dbNames where we have conflicts. This can occur because the replicator
    // was dirtied, locked or otherwise updated between the _getCleanOrLocked() and _dirty() calls
    // above. We use an object instead of an array as we want to make sure that we only have a
    // single entry per db or else we can end up with an infinitely growing list due to the
    // recursion.
    var conflictedDBNames = {}
    response.forEach((doc, i) => {
      if (this._slouch.doc.isConflictError(doc)) {
        conflictedDBNames[this._toDBName(replicators[i].source)] = true
      }
    })

    return sporks.keys(conflictedDBNames)
  }

  async _attemptToDirtyIfCleanOrLocked(dbNames, dirtyDate) {
    let replicators = await this._getCleanOrLocked(dbNames)

    // length can be zero if there is nothing to dirty
    if (replicators.length > 0) {
      return this._dirtyAndGetConflictedDBNames(replicators, dirtyDate)
    }
  }

  // We need to dirty replicators so that the replication can be delegated to a replicator process.
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
  async dirtyIfCleanOrLocked(dbNames, dirtyDate) {
    let conflictedDBNames = await this._attemptToDirtyIfCleanOrLocked(dbNames, dirtyDate)
    if (conflictedDBNames && conflictedDBNames.length > 0) {
      return this.dirtyIfCleanOrLocked(conflictedDBNames, dirtyDate)
    }

    // In case anything dirtied has dirty_after_milliseconds set
    this._queueSoiler(0)
  }

  _toCouchDBReplicationParams(params) {
    // We choose to blacklist as oppossed to whitelist so that any future CouchDB replication
    // parameters will work without Spiegel being updated
    let couchParams = {}
    sporks.each(params, (value, name) => {
      // Is the param for CouchDB?
      if (this._spiegelReplicationParams.indexOf(name) === -1) {
        couchParams[name] = value
      }
    })
    return couchParams
  }

  _addPassword(urlString) {
    return this._passwordInjector.addPassword(urlString)
  }

  _censorPasswordInURL(url) {
    return url ? utils.censorPasswordInURL(url) : url
  }

  _slouchReplicate(params) {
    return this._slouch.db.replicate(params)
  }

  async _replicate(replicator) {
    let couchParams = this._toCouchDBReplicationParams(replicator)

    // Add passwords to URLs based on hostname and username so that passwords are not embedded in
    // the replicator docs
    couchParams.source = this._addPassword(couchParams.source)
    couchParams.target = this._addPassword(couchParams.target)

    let sourceNoPwd = this._censorPasswordInURL(couchParams.source)
    let targetNoPwd = this._censorPasswordInURL(couchParams.target)

    log.info('Beginning replication from', sourceNoPwd, 'to', targetNoPwd)

    await this._slouchReplicate(couchParams)

    log.info('Finished replication from', sourceNoPwd, 'to', targetNoPwd)
  }

  async _process(item) {
    await this._replicate(item)
  }
}

module.exports = Replicators
