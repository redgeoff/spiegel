'use strict'

const path = require('path')
const spawn = require('child_process').spawn
const utils = require('../../src/utils')
const Spiegel = require('../../src/spiegel')
const sporks = require('sporks')
const JSONStream = require('JSONStream')

class Spawner {
  constructor () {
    this._children = []
    this._dbName = 'test_spiegel_integration'
    this._namespace = 'test_spiegel_integration_'

    this._spiegel = new Spiegel(null, { dbName: this._dbName, namespace: this._namespace })
  }

  _spawn (opts) {
    opts.push('--db-name=' + this._dbName)
    opts.push('--namespace=' + this._namespace)
    opts.push('--url=' + utils.couchDBURL())

    // Uncomment for extra debugging
    // opts.push('--log-level=debug')

    let child = spawn(path.join(__dirname, '/../../bin/cmd.js'), opts)

    child.stdout.pipe(JSONStream.parse()).on('data', logEntry => {
      // Uncomment for extra debugging
      // console.log('logEntry=', logEntry, '\n')

      // An error entry? There shouldn't be any errors
      if (logEntry.level > 30) {
        throw new Error(logEntry)
      }
    })

    child.stderr.on('data', (/* data */) => {
      throw new Error('should not get data on stderr ' + JSON.stringify(opts))
    })

    child.on('error', err => {
      throw new Error(err.message + ' for ' + JSON.stringify(opts))
    })

    child.on('close', code => {
      if (code > 0) {
        throw new Error('non-zero exit code for ' + JSON.stringify(opts))
      }
    })

    let closed = sporks.once(child, 'close')

    this._children.push({ child, closed })
  }

  _startUpdateListener () {
    this._spawn(['--type=update-listener'])
  }

  _startReplicator () {
    this._spawn([
      '--type=replicator',
      '--replicator-passwords=' + path.join(__dirname, '/replicator-passwords.json')
    ])
  }

  _startChangeListener () {
    this._spawn([
      '--type=change-listener',
      '--change-listener-passwords=' + path.join(__dirname, '/change-listener-passwords.json')
    ])
  }

  async start () {
    // Install spiegel so that there is no race condition installing it when we run the instances
    // below
    await this._spiegel.install()

    // Spawn 2 instances of each process so that we can simulate a distributed setup
    this._startUpdateListener()
    this._startUpdateListener()
    this._startReplicator()
    this._startReplicator()
    this._startChangeListener()
    this._startChangeListener()
  }

  async stop () {
    // Stop all the processes
    this._children.forEach(child => {
      child.child.kill('SIGINT')
    })

    // Wait for all the processes to close
    await Promise.all(this._children.map(child => child.closed))

    // Uninstall Spiegel
    await this._spiegel.uninstall()
  }
}

module.exports = Spawner
