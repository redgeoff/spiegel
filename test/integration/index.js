'use strict'

const Server = require('./api-server')
const Spawner = require('./spawner')
const sporks = require('sporks')

// A basic sanity test at the topmost layer to make sure that things are working
describe('integration', () => {
  let server = null
  let spawner = null

  beforeEach(async () => {
    server = new Server()
    await server.start()

    spawner = new Spawner()
    await spawner.start()
  })

  afterEach(async () => {
    await spawner.stop()

    await server.stop()
  })

  it('should replicate and listen to changes', async () => {
    await sporks.timeout(5000)
  })
})
