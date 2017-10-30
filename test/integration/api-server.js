'use strict'

const Koa = require('koa')
const route = require('koa-route')
const auth = require('koa-basic-auth')

class Server {
  constructor () {
    this.numRequests = 0
    this._server = null
  }

  start () {
    let app = new Koa()

    app.use(auth({ name: 'user', pass: 'secret' }))

    app.use(
      route.get('/foo', async ctx => {
        this.numRequests++
        ctx.body = 'Hello World'
      })
    )

    this._server = app.listen(3000)
  }

  stop () {
    this._server.close()
  }
}

module.exports = Server
