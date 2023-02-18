const BACKOFF_TYPE_LINEAR = 'linear'
const BACKOFF_TYPE_EXPONENTIAL = 'exponential'

class Backoff {
  constructor(strategy, base, delay, limit) {
    this.strategy = strategy
    this.base = base
    this.delay = delay
    this.limit = limit
  }

  _getLinearDelaySecs() {
    return this.delay
  }

  _getExponentialDelaySecs(occurrence) {
    return this.delay * (this.base ** occurrence)
  }

  hasReachedRetryLimit(occurrence) {
    return this.limit !== 0 && occurrence >= this.limit
  }

  getDelaySecs(occurrence) {
    switch (this.strategy) {
      case BACKOFF_TYPE_LINEAR:
        return this._getLinearDelaySecs()
      case BACKOFF_TYPE_EXPONENTIAL:
        return this._getExponentialDelaySecs(occurrence)
    }
  }
}

module.exports = {
  Backoff,
  BACKOFF_TYPE_LINEAR,
  BACKOFF_TYPE_EXPONENTIAL
}
