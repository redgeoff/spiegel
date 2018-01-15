const Koa = require('koa')
const route = require('koa-route')

class Server {
  constructor() {
    this._app = new Koa()

    this._app.use(
      route.put('/message/after', ctx => {
        // TODO
        ctx.body = 'Success'
      })
    )
  }

  start() {
    this._server = this._app.listen(3000)
  }

  stop() {
    this._server.close()
  }
}

module.exports = Server
