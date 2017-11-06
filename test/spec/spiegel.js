'use strict'

const Spiegel = require('../../src/spiegel')
const testUtils = require('../utils')
const Slouch = require('couch-slouch')
const sporks = require('sporks')

describe('spiegel', () => {
  let spiegel = null
  let calls = null

  const spy = () => {
    calls = []
    testUtils.spy(spiegel, ['install'], calls)
  }

  const newSpiegel = type => {
    return new Spiegel(type, { dbName: 'test2_spiegel', namespace: 'test2_' })
  }

  beforeEach(async () => {
    // test1_ is already taken by testUtils
    spiegel = newSpiegel(null)
    spy()
    await spiegel.install()
  })

  afterEach(async () => {
    await spiegel.uninstall()
  })

  it('must have _admin to access', async () => {
    let slouch = new Slouch(testUtils.couchDBURLWithoutAuth())
    await sporks.shouldThrow(
      () => {
        return slouch.db.get('test2_spiegel')
      },
      { name: 'NotAuthorizedError' }
    )
  })

  // const fakeInstall = () => {
  //   spiegel.install = async () => {
  //     calls.install.push(arguments)
  //   }
  // }

  // it('installIfNotInstalled should install if not installed', async () => {
  //   // Fake not installed
  //   spiegel._installed = sporks.resolveFactory(false)
  //
  //   fakeInstall()
  //
  //   await spiegel.installIfNotInstalled()
  //
  //   // First install from beforeEach and 2nd from installIfNotInstalled() above
  //   calls.install.length.should.eql(2)
  // })

  // it('installIfNotInstalled should not install if installed', async () => {
  //   // Fake installed
  //   spiegel._installed = sporks.resolveFactory(true)
  //
  //   fakeInstall()
  //
  //   await spiegel.installIfNotInstalled()
  //
  //   // First install from beforeEach
  //   calls.install.length.should.eql(1)
  // })

  const shouldStartAndStop = async type => {
    // Sanity test. TODO: spy on calls
    let spiegel2 = newSpiegel(type)

    // Fake
    spiegel2._onChanges.start = sporks.resolveFactory()
    spiegel2._onChanges.stop = sporks.resolveFactory()
    spiegel2._updateListeners.start = sporks.resolveFactory()
    spiegel2._updateListeners.stop = sporks.resolveFactory()
    spiegel2._changeListeners.start = sporks.resolveFactory()
    spiegel2._changeListeners.stop = sporks.resolveFactory()
    spiegel2._replicators.start = sporks.resolveFactory()
    spiegel2._replicators.stop = sporks.resolveFactory()
    spiegel2.install = sporks.resolveFactory()
    spiegel2.uninstall = sporks.resolveFactory()

    await spiegel2.start()
    await spiegel2.stop()
  }

  it('should start and stop update-listener', async () => {
    await shouldStartAndStop('update-listener')
  })

  it('should start and stop change-listener', async () => {
    await shouldStartAndStop('change-listener')
  })

  it('should start and stop replicator', async () => {
    await shouldStartAndStop('replicator')
  })

  it('should start and stop install', async () => {
    await shouldStartAndStop('install')
  })

  it('should start and stop uninstall', async () => {
    await shouldStartAndStop('uninstall')
  })
})
