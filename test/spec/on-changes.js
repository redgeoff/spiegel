'use strict'

const OnChanges = require('../../src/on-changes')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('on-changes', () => {
  let onChanges = null
  let docIds = []

  const createOnChanges = async () => {
    let onChangesInit = new OnChanges(testUtils.spiegel)
    await onChangesInit._create({
      _id: '1',
      db_name: 'foo'
    })
    docIds.push('1')

    await onChangesInit._create({
      _id: '2',
      db_name: '^test_db1$'
    })
    docIds.push('2')

    await onChangesInit._create({
      _id: '3',
      db_name: 'test_db_([^_])*'
    })
    docIds.push('3')
  }

  before(async () => {
    await createOnChanges()
  })

  after(async () => {
    await Promise.all(
      docIds.map(async docId => {
        await testUtils.spiegel._slouch.doc.getAndDestroy(testUtils.spiegel._dbName, docId)
      })
    )
  })

  beforeEach(async () => {
    onChanges = new OnChanges(testUtils.spiegel)
    await onChanges.start()
  })

  afterEach(async () => {
    await onChanges.stop()
  })

  it('should get all', async () => {
    // let before = new Date()

    let docs = await onChanges.all()

    // See 'should get all with forEach' for speed analysis
    // let after = new Date()
    // console.log('took', after.getTime() - before.getTime(), 'ms')

    sporks.length(docs).should.eql(3)
    docs['1']._id.should.eql('1')
    docs['2']._id.should.eql('2')
    docs['3']._id.should.eql('3')
  })

  it('should sync destruction', async () => {
    let docs = await onChanges.all()

    // Set up promise that resolve when change is received
    let changed = sporks.once(onChanges, 'change')

    // Destroy the first OnChange by setting the _deleted attribute and make sure this propagates
    let firstId = docIds.shift()
    await testUtils.spiegel._slouch.doc.markAsDestroyed(testUtils.spiegel._dbName, firstId)

    await changed

    sporks.length(docs).should.eql(2)
    docs['2']._id.should.eql('2')
    docs['3']._id.should.eql('3')
  })

  it('should match with DB names', async () => {
    let dbNames = await onChanges.matchWithDBNames([
      '_test_db0',
      'test_db1',
      'test_db2',
      'test_db_3',
      'test_db_4'
    ])
    dbNames.should.eql(['test_db1', 'test_db_3', 'test_db_4'])

    dbNames = await onChanges.matchWithDBNames(['_test_db0'])
    dbNames.should.eql([])
  })

  // // This is a benchmark to see how much faster it would be to store the on-changes in a simple
  // // array than in the memory adapter. It turns out that it takes 10ms to read 2 docs with the
  // // PouchDB mem adapter and just 1 ms (or under) to read 2 docs in mem. The 10ms is probably
  // // negligible as the bigger bottleneck is probably with accessing the Change Listeners
  // it('should get all with forEach', function () {
  //   var docs = [
  //     {
  //       _id: '1',
  //       type: 'on_change',
  //       db_name: 'test_db1'
  //     },
  //     {
  //       _id: '1',
  //       type: 'on_change',
  //       db_name: 'test_db1'
  //     }
  //   ]
  //   let before = new Date()
  //   docs.forEach(function (doc) {
  //     console.log(doc)
  //   })
  //   let after = new Date()
  //   console.log('took', after.getTime() - before.getTime(), 'ms')
  // })

  it('should get matching on-changes', async () => {
    // Fake all
    onChanges.all = async () => {
      return {
        '0': {
          _id: '0',
          db_name: '^fo'
        },

        '1': {
          _id: '1',
          db_name: 'foo',
          if: {
            _id: 'some-id'
          }
        },

        '2': {
          _id: '2',
          db_name: 'foo',
          if: {
            type: 'work',
            priority: 'medium|high'
          }
        },

        '3': {
          _id: '3',
          db_name: 'bar'
        }
      }
    }

    let matchingOnChanges = await onChanges.getMatchingOnChanges('foo', {
      _id: 'some-id',
      type: 'work',
      priority: 'high'
    })
    matchingOnChanges.should.eql({
      '0': {
        _id: '0',
        db_name: '^fo'
      },

      '1': {
        _id: '1',
        db_name: 'foo',
        if: {
          _id: 'some-id'
        }
      },

      '2': {
        _id: '2',
        db_name: 'foo',
        if: {
          type: 'work',
          priority: 'medium|high'
        }
      }
    })

    matchingOnChanges = await onChanges.getMatchingOnChanges('foo', {
      type: 'work'
    })
    sporks.length(matchingOnChanges).should.eql(1)
    matchingOnChanges['0']._id.should.eql('0')

    matchingOnChanges = await onChanges.getMatchingOnChanges('bar', {
      _id: 'some-id',
      type: 'work',
      priority: 'high'
    })
    sporks.length(matchingOnChanges).should.eql(1)
    matchingOnChanges['3']._id.should.eql('3')
  })
})
