'use strict'

const Koa = require('koa')
const route = require('koa-route')
const auth = require('koa-basic-auth')

class Server {
  constructor() {
    this.numRequests = 0
    this._server = null
  }

  start() {
    let app = new Koa()

    app.use(auth({ name: 'user', pass: 'secret' }))

    app.use(
      route.get('/foo', async ctx => {
        this.numRequests++
        ctx.body = 'Hello World'
      })
    )

    app.use(
      route.get('/redirect', async ctx => {
        this.numRequests++
        ctx.redirect('/foo')
      })
    )

    app.use(
      route.put('/new', async ctx => {
        this.numRequests++
        ctx.body = 'created a Hello World'
        ctx.status = 201
      })
    )

    app.use(
      route.put('/redirect', async ctx => {
        this.numRequests++
        ctx.redirect('/new')
      })
    )

    app.use(
      route.get('/womp-womp', async ctx => {
        this.numRequests++
        // This will return an Error (400). We use a 400 error so that nothing is logged to stdout
        ctx.throw(400, 'Error')
      })
    )

    this._server = app.listen(3000)
  }

  stop() {
    this._server.close()
  }
}

module.exports = new Server()
