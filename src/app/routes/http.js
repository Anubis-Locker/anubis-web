import express from 'express'
import { login } from '../lib/login.js'
import { index } from '../lib/view.js'
import { getConstants } from '../lib/get-constants.js'
import { resolve } from 'path'
import {
  appRoot,
  isDev
} from '../common/runtime-constants.js'
import {
  jwtAuth,
  errHandler
} from '../lib/jwt.js'
import { fileTransferRoutes } from './file-transfer.js'

export function httpRoutes (app) {
  app.get('/', index)
  app.post('/api/login', login)
  app.get('/api/get-constants', jwtAuth, errHandler, getConstants)
  fileTransferRoutes(app)
  if (isDev) {
    app.use(express.static(
      resolve(appRoot, 'node_modules')
    ))
    app.use(express.static(
      resolve(appRoot, 'src/client/statics')
    ))
  } else {
    app.use(express.static(
      resolve(appRoot, 'dist/assets')
    ))
  }
}
