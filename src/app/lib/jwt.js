import { expressjwt } from 'express-jwt'
import jwtb from 'jsonwebtoken'
import { getSecret } from './security.js'

export const jwtAuth = expressjwt({
  secret: () => getSecret(),
  algorithms: ['HS256'],
  getToken: function fromHeaderOrQuerystring (req) {
    return req.headers.token
  }
})

export const errHandler = function (err, req, res, next) {
  if (err && err.name === 'UnauthorizedError') {
    res.status(401).send('invalid token...')
  } else {
    next()
  }
}

export function createToken (
  user = process.env.SERVER_USER,
  pass = getSecret(),
  expire = process.env.TOKEN_EXPIRED_TIME || '12h'
) {
  const x = jwtb.sign({
    id: user
  }, pass, { expiresIn: expire })
  return x
}

export function verify (token) {
  return jwtb.verify(token, getSecret(), { algorithms: ['HS256'] })
}
