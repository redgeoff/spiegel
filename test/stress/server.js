const Koa = require('koa')
const route = require('koa-route')
const koaBody = require('koa-body')

class Server {
  constructor() {
    this._app = new Koa()

    this._app.use(
      koaBody({
        jsonLimit: '1kb'
      })
    )

    this._app.use(
      route.post('/message/after', ctx => {
        console.log(ctx.request.body)
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
