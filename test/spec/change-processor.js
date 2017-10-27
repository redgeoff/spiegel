'use strict'

const ChangeProcessor = require('../../src/change-processor')
const testUtils = require('../utils')

describe('change-processor', () => {
  let changeProcessor

  beforeEach(async () => {
    changeProcessor = new ChangeProcessor(testUtils.spiegel)
  })

  it('should build params', () => {
    let doc = {
      _id: '1',
      _rev: '1',
      thing: 'jam'
    }

    let change = {
      doc
    }

    let onChange = {
      params: {
        foo: 'bar',
        change: '$change',
        db_name: '$db_name'
      }
    }

    let params = changeProcessor._buildParams(change, onChange, 'test_db1')

    params.should.eql({
      foo: 'bar',
      change: change.doc,
      db_name: 'test_db1'
    })
  })
})
