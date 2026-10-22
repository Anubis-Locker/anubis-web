/**
 * simple login with password only
 */

import { createToken } from './jwt.js'
import {
  safeEqual,
  createRateLimiter,
  isAuthEnabled
} from './security.js'

const limiter = createRateLimiter({
  max: parseInt(process.env.LOGIN_MAX_FAILS || '10', 10),
  windowMs: parseInt(process.env.LOGIN_WINDOW_MS || String(15 * 60 * 1000), 10)
})

export function login (req, res) {
  const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'
  if (limiter.isBlocked(key)) {
    res.setHeader('Retry-After', String(limiter.retryAfter(key)))
    return res.status(429).send('too many attempts, try later')
  }
  if (!isAuthEnabled()) {
    return res.status(404).send('auth disabled')
  }
  const password = req.body && req.body.password
  if (typeof password !== 'string' || !safeEqual(password, process.env.SERVER_PASS)) {
    limiter.fail(key)
    return res.status(401).send('pass not right')
  }
  limiter.success(key)
  const token = createToken()
  res.send(token)
}
