'use strict'

const OnChanges = require('../../src/on-changes')
const testUtils = require('../utils')
const sporks = require('sporks')

describe('on-changes', () => {
  let onChanges = null
  let docIds = []

  const createOnChanges = async () => {
    await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, {
      _id: '1',
      type: 'on_change',
      reg_ex: '^test_db1$'
    })
    docIds.push('1')

    await testUtils.spiegel._slouch.doc.create(testUtils.spiegel._dbName, {
      _id: '2',
      type: 'on_change',
      reg_ex: 'test_db_([^_])*'
    })
    docIds.push('2')
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

    sporks.length(docs).should.eql(2)
    docs['1']._id.should.eql('1')
    docs['2']._id.should.eql('2')
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
  //       reg_ex: 'test_db1'
  //     },
  //     {
  //       _id: '1',
  //       type: 'on_change',
  //       reg_ex: 'test_db1'
  //     }
  //   ]
  //   let before = new Date()
  //   docs.forEach(function (doc) {
  //     console.log(doc)
  //   })
  //   let after = new Date()
  //   console.log('took', after.getTime() - before.getTime(), 'ms')
  // })
})
