class DatabaseNotFoundError extends Error {
  constructor(message, ...args) {
    super('Database not found: ' + message, ...args)
  }
}

module.exports = {
  DatabaseNotFoundError
}
