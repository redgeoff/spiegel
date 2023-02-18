class DatabaseNotFoundError extends Error {
  constructor(message, ...args) {
    super('Database not found: ' + message, ...args)
  }
}

class ApiRequestError extends Error {
  constructor(message, ...args) {
    super('API request failed: ' + message, ...args)
  }
}

module.exports = {
  DatabaseNotFoundError,
  ApiRequestError
}
