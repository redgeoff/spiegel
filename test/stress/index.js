'use strict'

// const Spawner = require('../integration/spawner')
const Runner = require('./runner')
const testUtils = require('../utils')
const utils = require('../../src/utils')
const sporks = require('sporks')
const Server = require('./server')

describe('stress', function() {
  const NUM_USERS = 3
  const NUM_MESSAGES = 3
  const TIMEOUT = 300000

  this.timeout(TIMEOUT)

  let runner = null
  let userDBs = []
  let totalMs = null
  let received = null
  let userCount = null
  let n = 0
  let iterator = null
  let server = null

  const createUserDB = async() => {
    let dbName = 'user_' + userCount++

    // Have to push before creating to ensure sequential order in array
    userDBs.push(dbName)

    await testUtils._slouch.db.create(dbName)
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

  // In order to avoid missing changes due to race conditions when setting up a listener per trial
  // we set up a single listener that will run for the duration of all our trials.
  const listenForMessages = async() => {
    iterator = testUtils._slouch.db.changes('_global_changes', {
      feed: 'continuous',
      heartbeat: true,
      since: 'now'
    })

    received = {}

    iterator
      .each(item => {
        let change = item.id.split(':')

        // Ignore any changes caused from creating the DB and not for the user DBs
        if (change[0] === 'updated' && change[1].indexOf('user_') !== -1) {
          received[change[1]] = true

          // console.log('received=', received)
        }
      })
      .catch(function(err) {
        console.log('iterator err=', err)
      })

    iterator.on('error', function(err) {
      console.log('iterator on err=', err)
    })
  }

  const doBefore = async() => {
    // runner = new Spawner()
    runner = new Runner()
    server = new Server()
    userCount = 0
    listenForMessages()
    await runner.start()
    server.start()
    await createUserDBs()
  }

  const doAfter = async() => {
    // Wait for any remaining replications
    await sporks.timeout(10000)

    await checkNumDocs()

    iterator.abort()
    await runner.stop()
    server.stop()
    // await destroyReplicators()
    await destroyUserDBs()
  }

  beforeEach(async() => {
    received = {}
  })

  // TODO: move to slouch
  const downsert = (dbName, docId) => {
    return testUtils._slouch.doc._persistThroughConflicts(() => {
      return testUtils._slouch.doc.getAndDestroy(dbName, docId)
    })
  }

  const numDocs = async j => {
    let user = await testUtils._slouch.db.get('user_' + j)
    if (user.doc_count !== n) {
      throw new Error(
        'Number of docs incorrect: ' +
          JSON.stringify({
            'user.doc_count': user.doc_count,
            n: n,
            user: user
          })
      )
    }
  }

  const checkNumDocs = async() => {
    let promises = []
    for (let j = 0; j < NUM_USERS; j++) {
      promises.push(numDocs(j))
    }
    await Promise.all(promises)
  }

  afterEach(async() => {
    if (sporks.length(received) !== NUM_USERS) {
      throw new Error(
        'Number of received is incorrect',
        JSON.stringify({
          numReceived: sporks.length(received),
          received: received,
          userDBs: userDBs,
          time: new Date()
        })
      )
      // console.log('EXITING...')
      // process.exit(-1)
    }
  })

  const waitForMessages = async() => {
    received = {}

    await sporks.waitFor(() => {
      return sporks.length(received) === NUM_USERS ? true : undefined
    }, TIMEOUT)
  }

  const sendMessage = async() => {
    let before = new Date()
    let waitFor = waitForMessages()
    let msg = {
      msg: 'this is sample message ' + n,
      created_at: new Date().toISOString()
    }
    console.log('sending msg', msg)
    await testUtils._slouch.doc.create(userDBs[0], msg)
    await waitFor
    let ms = new Date().getTime() - before.getTime()
    // console.log('Took %s ms to send a message', ms)
    totalMs += ms
  }

  const sendMessages = async() => {
    for (let i = 1; i <= NUM_MESSAGES; i++) {
      it('trial ' + i + ': replicate messages to ' + (NUM_USERS - 1) + ' users', async() => {
        n = i

        await sendMessage()

        if (i === NUM_MESSAGES) {
          console.log('Took an average of %s ms to send a message', totalMs / NUM_MESSAGES)
        }
      })
    }
  }

  describe('replicator', function() {
    let replicatorIds = null

    const createReplicator = async(dbName1, dbName2) => {
      let replicator = await testUtils._slouch.doc.create(runner._dbName, {
        type: 'replicator',
        source: utils.couchDBURL() + '/' + dbName1,
        target: utils.couchDBURL() + '/' + dbName2
      })
      replicatorIds.push(replicator.id)
    }

    // We will implement a very limited design that replicates all messages from user1 to all other
    // users and not vise-versa. In most applications you would not choose this design as it
    // requires a replicator per user pair and that simply will not scale well.
    const createReplicators = async() => {
      let promises = []
      for (let i = 1; i < NUM_USERS; i++) {
        promises.push(createReplicator(userDBs[0], userDBs[i]))
      }
      await Promise.all(promises)
    }

    const destroyReplicators = async() => {
      await Promise.all(replicatorIds.map(async id => downsert(runner._dbName, id)))
    }

    before(async() => {
      await doBefore()
      replicatorIds = []
      await createReplicators()
    })

    after(async() => {
      await destroyReplicators()
      await doAfter()
    })

    sendMessages()
  })

  describe('on-change', function() {
    let onChange = null

    // This will result in creating a change-listener per user DB, which will provide a great stress
    // test for the change-listeners
    const createOnChange = async() => {
      onChange = await testUtils._slouch.doc.create(runner._dbName, {
        type: 'on_change',

        db_name: '^user_(.*)$',

        url: 'http://localhost:3000/message/after',

        params: {
          change: '$change',
          db_name: '$db_name',
          num_users: NUM_USERS
        },

        method: 'POST',
        debounce: true
      })
    }

    const destroyOnChange = async() => {
      await downsert(runner._dbName, onChange.id)
    }

    before(async() => {
      await doBefore()
      await createOnChange()
    })

    after(async() => {
      await destroyOnChange()
      await doAfter()
    })

    sendMessages()
  })
})
