import express from 'express'
import pug from 'pug'
import { wsRoutes } from '../routes/ws.js'
import { httpRoutes } from '../routes/http.js'
import { applyExtensions } from '../lib/extensions.js'
import morgan from 'morgan'
import {
  isDev,
  cwd
} from '../common/runtime-constants.js'
import { resolve } from 'path'
import log from '../common/log.js'
import { applySystemCAsToGlobalAgent } from '../lib/system-ca.js'

export async function createApp () {
  const loadedCount = applySystemCAsToGlobalAgent()
  if (loadedCount > 0) {
    log.info(`[TLS] loaded ${loadedCount} system CA certificate(s) into main process`)
  }

  const app = express()
  if (process.env.TRUST_PROXY) {
    const tp = process.env.TRUST_PROXY
    app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : (tp === 'true' ? true : tp))
  }
  // CORS is an allowlist only (CORS_ORIGINS, comma separated); default: none
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const origin = req.headers.origin
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204)
      }
    }
    next()
  })
  // parse application/x-www-form-urlencoded
  app.use(express.urlencoded({ extended: true }))

  // parse application/json
  app.use(express.json())

  app.use(morgan(
    ':method :url :status :res[content-length] - :response-time ms'
  ))
  app.set('view engine', 'pug')
  // Register the engine explicitly. Without this Express lazily `require('pug')`
  // at render time, which a bundler cannot see — the string is only produced at
  // runtime, so "pug" is missing from the bundle and GET / hangs forever.
  app.engine('pug', pug.__express)
  app.set(
    'views',
    process.env.VIEW_FOLDER ||
    (
      !isDev
        ? resolve(cwd, 'dist/views')
        : resolve(cwd, 'src/app/views')
    )
  )
  app.set('x-powered-by', false)

  httpRoutes(app)
  wsRoutes(app)
  await applyExtensions(app)
  return app
}
