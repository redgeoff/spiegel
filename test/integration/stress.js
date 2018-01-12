'use strict'

const Spawner = require('./spawner')
const testUtils = require('../utils')
const utils = require('../../src/utils')
const sporks = require('sporks')

describe('stress', function() {
  const NUM_USERS = 3
  const NUM_MESSAGES = 1000

  this.timeout(120000)

  let spawner = null
  let userDBs = []
  let replicatorIds = null
  let totalMs = null
  let received = null
  let userCount = null

  const createUserDB = async() => {
    let dbName = 'user_' + userCount++
    await testUtils._slouch.db.create(dbName)
    userDBs.push(dbName)
  }

  const createUserDBs = async() => {
    let promises = []
    for (let i = 0; i < NUM_USERS; i++) {
      promises.push(createUserDB())
    }
    await Promise.all(promises)
  }

  const destroyUserDBs = async() => {
    await Promise.all(userDBs.map(async dbName => testUtils._slouch.db.destroy(dbName)))
    userDBs = []
  }

  const createReplicator = async(dbName1, dbName2) => {
    let replicator = await testUtils._slouch.doc.create(spawner._dbName, {
      type: 'replicator',
      source: utils.couchDBURL() + '/' + dbName1,
      target: utils.couchDBURL() + '/' + dbName2
    })
    replicatorIds.push(replicator.id)
  }

  // We will implement a very limited design that replicates all messages from user1 to all other
  // users and not vise-versa. In most applications you would not choose this design as it requires
  // a replicator per user pair and that simply will not scale well.
  const createReplicators = async() => {
    let promises = []
    for (let i = 1; i < NUM_USERS; i++) {
      promises.push(createReplicator(userDBs[0], userDBs[i]))
    }
    await Promise.all(promises)
  }

  // // TODO: move to slouch
  // const downsert = (dbName, docId) => {
  //   return testUtils._slouch.doc._persistThroughConflicts(() => {
  //     return testUtils._slouch.doc.getAndDestroy(dbName, docId)
  //   })
  // }
  //
  // const destroyReplicators = async () => {
  //   await Promise.all(replicatorIds.map(async id => await downsert(spawner._dbName, id)))
  // }

  before(async() => {
    replicatorIds = []
    spawner = new Spawner()
    await spawner.start()
    await createUserDBs()
    await createReplicators()
  })

  after(async() => {
    await spawner.stop()
    // await destroyReplicators()
    await destroyUserDBs()
  })

  beforeEach(async() => {
    received = {}
    userCount = 1
  })

  afterEach(async() => {
    if (sporks.length(received) !== NUM_USERS) {
      console.error('received=', received)
      console.error('userDBs=', userDBs)
      // console.error('num received', sporks.length(received))
      // console.log('EXITING...')
      // process.exit(-1)
    }
  })

  const waitForMessages = async() => {
    let iterator = testUtils._slouch.db.changes('_global_changes', {
      feed: 'continuous',
      heartbeat: true,
      since: 'now'
    })

    received = {}

    await iterator.each(item => {
      let change = item.id.split(':')

      // Ignore any changes caused from creating the DB and not for the user DBs
      if (change[0] === 'updated' && change[1].indexOf('user_') !== -1) {
        received[change[1]] = true

        console.log('received=', received)

        // Received changes for all DBs? The change to the first DB is done directly and the reset
        // should receive replicated changes
        if (sporks.length(received) === NUM_USERS) {
          // console.log('received=', received)
          iterator.abort()
        }
      }
    })
  }

  const sendMessage = async i => {
    let before = new Date()
    let waitFor = waitForMessages()
    let msg = {
      msg: 'this is sample message ' + i,
      created_at: new Date().toISOString()
    }
    console.log('sending msg', msg)
    await testUtils._slouch.doc.create(userDBs[0], msg)
    await waitFor
    let ms = new Date().getTime() - before.getTime()
    // console.log('Took %s ms to send a message', ms)
    totalMs += ms
  }

  for (let i = 1; i <= NUM_MESSAGES; i++) {
    it('trial ' + i + ': replicate messages to ' + (NUM_USERS - 1) + ' users', async() => {
      await sendMessage(i)

      if (i === NUM_MESSAGES) {
        console.log('Took an average of %s ms to send a message', totalMs / NUM_MESSAGES)
      }
    })
  }
})
