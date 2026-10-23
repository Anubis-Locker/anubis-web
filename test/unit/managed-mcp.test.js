import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { managedMcpProxy } from '../../src/app/lib/managed-mcp.js'

test('managed MCP proxy requires private authentication, respects disable, and forwards only to fixed loopback', async t => {
  const secret = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  const captured = []
  const upstream = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' })
    res.end('{"jsonrpc":"2.0","result":{}}')
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const env = {}
  let target = null
  const app = express()
  app.all('/mcp', managedMcpProxy({ secret, env, getTarget: () => target }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    for (const listener of [server, upstream]) {
      listener.closeAllConnections()
      await new Promise(resolve => listener.close(resolve))
    }
  })
  const url = `http://127.0.0.1:${server.address().port}/mcp`
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await fetch(url, { headers: { 'x-anubis-managed-auth': 'spoofed' } })).status, 401)
  const headers = { 'x-anubis-managed-auth': secret, 'content-type': 'application/json' }
  assert.equal((await fetch(url, { headers })).status, 503)
  target = { port: upstream.address().port, token, host: 'untrusted.invalid' }
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer public-grant-must-not-be-forwarded', cookie: 'private-cookie' },
    body: '{"jsonrpc":"2.0","method":"initialize","id":1}'
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('mcp-session-id'), 'fixture-session')
  assert.equal(captured.length, 1)
  assert.equal(captured[0].path, '/mcp')
  assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
  assert.equal(captured[0].headers['x-anubis-managed-auth'], undefined)
  assert.equal(captured[0].headers.cookie, undefined)
  assert.equal(JSON.parse(captured[0].body).method, 'initialize')
  for (const disabled of ['false', '0', 'off']) {
    env.MCP_ENABLED = disabled
    assert.equal((await fetch(url, { headers })).status, 404)
  }
  delete env.MCP_ENABLED
  assert.equal((await fetch(url, { method: 'PUT', headers })).status, 405)
  assert.equal((await fetch(url + '/', { headers })).status, 404)
  assert.equal((await fetch(url + '/other', { headers })).status, 404)
  assert.equal(captured.length, 1)
})
