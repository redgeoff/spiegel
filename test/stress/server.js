const Koa = require('koa')
const route = require('koa-route')
const koaBody = require('koa-body')
const testUtils = require('../utils')
const utils = require('../../src/utils')

class Server {
  constructor() {
    this._app = new Koa()

    this._app.use(
      koaBody({
        jsonLimit: '1kb'
      })
    )

    this._app.use(
      route.post('/message/after', async ctx => {
        // console.log(ctx.request.body)

        // Replicate to the message to the next user. This would be silly in the real world as it is
        // very wasteful, but it makes for a good stress test.

        let fromDBName = ctx.request.body.db_name
        let i = parseInt(/^user_(.*)$/.exec(fromDBName)[1])

        // Is there a next user?
        if (i < ctx.request.body.num_users - 1) {
          let toDBName = 'user_' + (i + 1)
          await testUtils._slouch.db.replicate({
            source: utils.couchDBURL() + '/' + fromDBName,
            target: utils.couchDBURL() + '/' + toDBName,
            keys: JSON.stringify(ctx.request.body.change._id)
          })
        }

        // This data is arbitrary, but it must be supplied so that koa responds with a 200 status
        // code
        ctx.body = { status: 'success' }
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
