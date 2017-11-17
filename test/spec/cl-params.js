'use strict'

const CLParams = require('../../src/cl-params')
const sporks = require('sporks')

describe('cl-params', () => {
  let params = null
  let emptyOpts = null
  let types = ['install', 'uninstall', 'update-listener', 'change-listener', 'replicator']

  beforeEach(() => {
    params = new CLParams()
    emptyOpts = {
      common: {},
      'update-listener': {},
      'change-listener': {},
      replicator: {}
    }
  })

  it('should detect invalid opts', async () => {
    await Promise.all(
      types.map(async type => {
        let err = null
        try {
          await params.toOpts(type, { 'invalid-param': true })
        } catch (_err) {
          err = _err
        }
        err.message.should.eql('invalid parameter invalid-param')
      })
    )
  })

  it('should detect invalid opts for other type', async () => {
    let err = null
    try {
      await params.toOpts('update-listener', { 'passwords-file': true })
    } catch (_err) {
      err = _err
    }
    err.message.should.eql('invalid parameter passwords-file')
  })

  const shouldConvertInstallUninstallOpts = async type => {
    let opts = await params.toOpts(type, {
      'db-name': 'my-db-name',
      namespace: 'my-namespace',
      'log-level': 'my-log-level'
    })

    opts.should.eql(
      sporks.merge(emptyOpts, {
        common: {
          dbName: 'my-db-name',
          namespace: 'my-namespace',
          logLevel: 'my-log-level'
        }
      })
    )
  }

  it('should convert install opts', async () => {
    await shouldConvertInstallUninstallOpts('install')
  })

  it('should convert uninstall opts', async () => {
    await shouldConvertInstallUninstallOpts('uninstall')
  })

  it('should convert update-listener opts', async () => {})

  it('should convert change-listener opts', async () => {})

  it('should convert replicator opts', async () => {})
})
