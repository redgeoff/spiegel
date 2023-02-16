'use strict'
const assert = require('assert')
const { Backoff, BACKOFF_TYPE_LINEAR, BACKOFF_TYPE_EXPONENTIAL } = require('../../src/backoff')

describe('backoff', () => {
  it('should calculate constant interval when strategy is linear', () => {
    const type = BACKOFF_TYPE_LINEAR
    const multiplier = 2
    const delay = 5
    const limit = 3
    let backoff = new Backoff(type, multiplier, delay, limit)

    assert.strictEqual(backoff.getDelaySecs(1), 5)
    assert.strictEqual(backoff.getDelaySecs(2), 5)
    assert.strictEqual(backoff.getDelaySecs(3), 5)
  })

  it('should return true if retry limit has been reached', () => {
    const type = BACKOFF_TYPE_LINEAR
    const multiplier = 2
    const delay = 5
    const limit = 3
    let backoff = new Backoff(type, multiplier, delay, limit)

    assert.strictEqual(backoff.hasReachedRetryLimit(limit), true)
    assert.strictEqual(backoff.hasReachedRetryLimit(limit + 1), true)
  })

  it('should return false if retry limit has not been reached', () => {
    const type = BACKOFF_TYPE_LINEAR
    const multiplier = 2
    const delay = 5
    const limit = 3
    let backoff = new Backoff(type, multiplier, delay, limit)

    assert.strictEqual(backoff.hasReachedRetryLimit(limit - 1), false)
    assert.strictEqual(backoff.hasReachedRetryLimit(0), false)
  })

  it('should calculate exponential interval when strategy is exponential', () => {
    const type = BACKOFF_TYPE_EXPONENTIAL
    const multiplier = 2
    const delay = 5
    const limit = 5
    let backoff = new Backoff(type, multiplier, delay, limit)

    assert.strictEqual(backoff.getDelaySecs(0), 5)
    assert.strictEqual(backoff.getDelaySecs(1), 10)
    assert.strictEqual(backoff.getDelaySecs(2), 20)
    assert.strictEqual(backoff.getDelaySecs(3), 40)
    assert.strictEqual(backoff.getDelaySecs(4), 80)
  })

  it('should calculate exponential interval with given multiplier', () => {
    const type = BACKOFF_TYPE_EXPONENTIAL
    const multiplier = 3
    const delay = 5
    const limit = 5
    let backoff = new Backoff(type, multiplier, delay, limit)

    assert.strictEqual(backoff.getDelaySecs(0), 5)
    assert.strictEqual(backoff.getDelaySecs(1), 15)
    assert.strictEqual(backoff.getDelaySecs(2), 45)
    assert.strictEqual(backoff.getDelaySecs(3), 135)
    assert.strictEqual(backoff.getDelaySecs(4), 405)
  })
})
