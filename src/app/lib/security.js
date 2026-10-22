/**
 * Security helpers: auth switch, startup config checks, CORS, rate limiting.
 */

import crypto from 'crypto'

const KNOWN_WEAK_SECRETS = new Set([
  'x4345655@!3446%5FS334*sfdgsf',
  'x4345655@!3446%5FS334*sfdgsf # change it in production env',
  'changeme',
  'change-me',
  'secret',
  'some-server-secret'
])
const KNOWN_WEAK_PASSES = new Set([
  '1',
  '123456',
  'password',
  'changeme',
  'change-me',
  'admin',
  'some-login-pass-word'
])

/**
 * Auth is ON unless ENABLE_AUTH is explicitly 0/false/no/off.
 */
export function isAuthEnabled (env = process.env) {
  const v = String(env.ENABLE_AUTH ?? '').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(v)
}

export function isProduction (env = process.env) {
  return env.NODE_ENV === 'production'
}

/**
 * Return the JWT secret. If none is configured outside production a random
 * per-process secret is generated (tokens die on restart).
 */
export function getSecret () {
  if (!process.env.SERVER_SECRET) {
    process.env.SERVER_SECRET = crypto.randomBytes(32).toString('hex')
  }
  return process.env.SERVER_SECRET
}

/**
 * Validate configuration at start up.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkSecurityConfig (env = process.env) {
  const errors = []
  const warnings = []
  const prod = isProduction(env)
  const report = prod ? errors : warnings
  if (!isAuthEnabled(env)) {
    warnings.push(
      'ENABLE_AUTH=0: authentication is DISABLED, everyone who can reach this server gets a full shell/file access token.'
    )
    return { errors, warnings }
  }
  const secret = env.SERVER_SECRET || ''
  const pass = env.SERVER_PASS || ''
  if (!secret) {
    report.push('SERVER_SECRET is not set (required, use at least 32 random chars, e.g. `openssl rand -hex 32`).')
  } else if (KNOWN_WEAK_SECRETS.has(secret) || secret.length < 16) {
    report.push('SERVER_SECRET is a default/weak value (use at least 16, ideally 32+ random chars).')
  }
  if (!pass) {
    report.push('SERVER_PASS is not set.')
  } else if (KNOWN_WEAK_PASSES.has(pass)) {
    report.push('SERVER_PASS is a default/weak value, set a strong password.')
  }
  return { errors, warnings }
}

/**
 * Log warnings and exit(1) on errors (production only produces errors).
 */
export function enforceSecurityConfig (log = console) {
  const { errors, warnings } = checkSecurityConfig()
  warnings.forEach(w => log.warn(`[security] ${w}`))
  if (errors.length) {
    errors.forEach(e => log.error(`[security] ${e}`))
    console.error(
      '\n[security] Refusing to start in production with insecure settings:\n - ' +
      errors.join('\n - ') +
      '\nFix your .env (see .sample.env).'
    )
    process.exit(1)
  }
}

export function safeEqual (a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest()
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * Restrictive CORS: no CORS headers unless the Origin is listed in
 * CORS_ORIGINS (comma separated). Same-origin requests need no CORS.
 */
export function corsMiddleware (env = process.env) {
  const allowed = new Set(
    (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  )
  return (req, res, next) => {
    const origin = req.headers.origin
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, token')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') {
      return res.status(origin && allowed.has(origin) ? 204 : 403).end()
    }
    next()
  }
}

/**
 * Baseline security headers for the app (CSP is left to the reverse proxy
 * because the client needs inline styles/wasm).
 */
export function securityHeaders (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
}

/**
 * Tiny in-memory failure limiter keyed by client ip.
 */
export function createRateLimiter ({
  max = 10,
  windowMs = 15 * 60 * 1000
} = {}) {
  const hits = new Map()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) {
      if (v.reset <= now) hits.delete(k)
    }
  }, 60 * 1000)
  timer.unref()
  const entry = (key) => {
    const now = Date.now()
    let e = hits.get(key)
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + windowMs }
      hits.set(key, e)
    }
    return e
  }
  return {
    isBlocked: (key) => entry(key).count >= max,
    retryAfter: (key) => Math.ceil((entry(key).reset - Date.now()) / 1000),
    fail: (key) => { entry(key).count++ },
    success: (key) => { hits.delete(key) }
  }
}
