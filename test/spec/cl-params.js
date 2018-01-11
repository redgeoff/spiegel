'use strict'

const CLParams = require('../../src/cl-params')
const sporks = require('sporks')
const path = require('path')

describe('cl-params', () => {
  let params = null
  let emptyOpts = null
  let types = ['install', 'uninstall', 'update-listener', 'change-listener', 'replicator']
  let url = 'https://admin:admin@example.com:5984'
  let passwordsFile = path.join(__dirname, '/../integration/change-listener-passwords.json')
  let passwords = {
    localhost: {
      user: 'secret'
    }
  }

  beforeEach(() => {
    params = new CLParams()
    emptyOpts = {
      common: {},
      'update-listener': {},
      'change-listener': {},
      replicator: {}
    }
  })

  it('should detect invalid opts', async() => {
    await Promise.all(
      types.map(async type => {
        let err = null
        try {
          await params._toOpts({ type: type, 'invalid-param': true })
        } catch (_err) {
          err = _err
        }
        err.message.should.eql('invalid parameter invalid-param')
      })
    )
  })

  it('should detect invalid opts for other type', async() => {
    let err = null
    try {
      await params._toOpts({ type: 'update-listener', 'passwords-file': true })
    } catch (_err) {
      err = _err
    }
    err.message.should.eql('invalid parameter passwords-file')
  })

  const shouldConvertInstallUninstallOpts = async type => {
    let opts = await params._toOpts({
      type: type,
      url: url,
      _: true, // should be ignored
      'db-name': 'my-db-name',
      namespace: 'my-namespace',
      'log-level': 'my-log-level'
    })

    opts.should.eql(
      sporks.merge(emptyOpts, {
        common: {
          type: type,
          url: url,
          dbName: 'my-db-name',
          namespace: 'my-namespace',
          logLevel: 'my-log-level'
        }
      })
    )
  }

  it('should convert install opts', async() => {
    await shouldConvertInstallUninstallOpts('install')
  })

  it('should convert uninstall opts', async() => {
    await shouldConvertInstallUninstallOpts('uninstall')
  })

  it('should convert update-listener opts', async() => {
    let opts = await params._toOpts({
      type: 'update-listener',
      'db-name': 'my-db-name',
      'batch-size': 10,
      'batch-timeout': 10,
      'save-seq-after': 100
    })

    opts.should.eql(
      sporks.merge(emptyOpts, {
        common: {
          type: 'update-listener',
          dbName: 'my-db-name'
        },
        'update-listener': {
          batchSize: 10,
          batchTimeout: 10,
          saveSeqAfterSeconds: 100
        }
      })
    )
  })

  it('should convert change-listener opts', async() => {
    let opts = await params._toOpts({
      type: 'change-listener',
      'db-name': 'my-db-name',
      'batch-size': 10,
      concurrency: 5,
      'retry-after': 100,
      'check-stalled': 1000,
      'passwords-file': passwordsFile
    })

    opts.should.eql(
      sporks.merge(emptyOpts, {
        common: {
          type: 'change-listener',
          dbName: 'my-db-name'
        },
        'change-listener': {
          batchSize: 10,
          concurrency: 5,
          retryAfterSeconds: 100,
          checkStalledSeconds: 1000,
          passwords: passwords
        }
      })
    )
  })

  it('should convert replicator opts', async() => {
    let opts = await params._toOpts({
      type: 'replicator',
      'db-name': 'my-db-name',
      concurrency: 5,
      'retry-after': 100,
      'check-stalled': 1000,
      'passwords-file': passwordsFile
    })

    opts.should.eql(
      sporks.merge(emptyOpts, {
        common: {
          type: 'replicator',
          dbName: 'my-db-name'
        },
        replicator: {
          concurrency: 5,
          retryAfterSeconds: 100,
          checkStalledSeconds: 1000,
          passwords: passwords
        }
      })
    )
  })

  it('should merge common opts', async() => {
    let opts = await params.toOpts({
      type: 'replicator',
      concurrency: 5
    })

    delete emptyOpts.common

    opts.should.eql(
      sporks.merge(emptyOpts, {
        type: 'replicator',
        replicator: {
          concurrency: 5
        }
      })
    )
  })
})
