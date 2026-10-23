import http from 'node:http'
import { safeEqual } from './security.js'
import { getManagedMcpTarget } from '../widgets/widget-mcp-server.js'
import log from '../common/log.js'

const responseHeaders = ['content-type', 'cache-control', 'mcp-session-id', 'mcp-protocol-version']
const requestHeaders = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']

export function managedMcpProxy ({ secret, env = process.env, getTarget = getManagedMcpTarget }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Managed MCP requires a private per-process authentication secret')
  }
  return (req, res) => {
    if (['false', '0', 'no', 'off'].includes(String(env.MCP_ENABLED).toLowerCase()) || req.path !== '/mcp') {
      return res.sendStatus(404)
    }
    const authorization = req.headers['x-anubis-managed-auth']
    if (typeof authorization !== 'string' || !safeEqual(authorization, secret)) {
      return res.sendStatus(401)
    }
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, DELETE')
      return res.sendStatus(405)
    }
    const target = getTarget()
    if (!target || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 ||
        typeof target.token !== 'string' || !target.token || /[\r\n]/.test(target.token)) {
      return res.status(503).json({ error: 'An authenticated loopback MCP widget must be running' })
    }
    const headers = { authorization: `Bearer ${target.token}` }
    for (const name of requestHeaders) {
      if (req.headers[name]) headers[name] = req.headers[name]
    }
    const upstream = http.request({
      host: '127.0.0.1',
      port: target.port,
      path: '/mcp',
      method: req.method,
      headers,
      agent: false
    }, remote => {
      clearTimeout(timeout)
      const headers = {}
      for (const name of responseHeaders) {
        if (remote.headers[name]) headers[name] = remote.headers[name]
      }
      res.writeHead(remote.statusCode, headers)
      res.flushHeaders()
      remote.on('error', error => res.destroy(error))
      remote.pipe(res)
    })
    const timeout = setTimeout(() => upstream.destroy(new Error('MCP upstream did not respond')), 130000)
    timeout.unref()
    upstream.on('error', error => {
      clearTimeout(timeout)
      log.error('[managed-mcp] Loopback request failed:', error.code || error.message)
      if (!res.headersSent) res.status(502).json({ error: 'Managed MCP endpoint is unavailable' })
      else res.destroy(error)
    })
    req.once('aborted', () => upstream.destroy())
    res.once('close', () => upstream.destroy())
    req.pipe(upstream)
  }
}
