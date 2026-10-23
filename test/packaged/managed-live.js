import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import { once } from 'node:events'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { parse } from 'dotenv'
import { chromium } from 'playwright'

const run = promisify(execFile)
const origin = 'https://api.anubis.locker'
const registry = 'https://npm.anubis.locker/'

function childEnvironment (env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    /^(path|pathext|systemroot|windir|comspec|home|userprofile|temp|tmp|appdata|localappdata|lang|lc_all|term|shell|programfiles|programfiles\(x86\))$/i.test(name)))
}

function verifyOwned (agent, identity, label, startedAt) {
  assert.equal(agent.id, identity.id)
  assert.equal(agent.fingerprint, createHash('sha256').update(identity.secret).digest('hex'))
  assert.equal(agent.label, label)
  assert.equal(agent.app, 'anubis-web')
  assert.equal(agent.version, '5.6.12')
  assert.equal(agent.platform, process.platform)
  const createdAt = typeof agent.createdAt === 'number'
    ? agent.createdAt
    : typeof agent.createdAt === 'string' ? Date.parse(agent.createdAt) : NaN
  assert.ok(Number.isFinite(createdAt) && createdAt >= startedAt - 5000 && createdAt <= Date.now(),
    'Refusing to mutate an older/unrelated registration')
  return agent
}

async function waitFor (predicate, message, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, message)
    await delay(200)
  }
}

async function reservePort () {
  const listener = net.createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

async function npmCli () {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...(process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean).map(directory =>
      process.platform === 'win32'
        ? join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : join(directory, 'npm'))
  ].filter(Boolean)
  for (const filename of candidates) {
    try {
      await access(filename)
      return filename
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    }
  }
  throw new Error('Cannot find the existing npm CLI; expose its Node installation on PATH')
}

function phaseFailure (phase, error) {
  const names = ['Error', 'TimeoutError', 'AbortError', 'AssertionError', 'AggregateError', 'TypeError', 'RangeError', 'SyntaxError']
  const codes = ['ABORT_ERR', 'ERR_ASSERTION', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']
  const name = names.includes(error?.name) ? error.name : 'Error'
  const code = codes.includes(error?.code) ? ` code=${error.code}` : ''
  const comparison = typeof error?.actual === 'number' && typeof error?.expected === 'number'
    ? ` actual=${error.actual} expected=${error.expected}`
    : ''
  return new Error(`Live QA phase=${phase} failed: ${name}${code}${comparison}`)
}

async function stopAdminRoutes (page) {
  if (!page) return
  if (!page.isClosed()) {
    // Invalidate dashboard continuations without aborting authorized requests.
    await page.evaluate('clearTimeout(timer); token = ""; generation++')
  }
  await page.unrouteAll({ behavior: 'wait' })
}

test('live QA never forwards management credentials or inherited runtime overrides to subprocesses', () => {
  assert.deepEqual(childEnvironment({
    PATH: 'node-path',
    SystemRoot: 'windows',
    ANUBIS_MANAGED_ADMIN_TOKEN: 'must-stay-in-node',
    ADMIN_TOKEN: 'also-private',
    MCP_TOKEN: 'unrelated-user-token',
    SERVER_PASS: 'unrelated-user-password',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    NODE_OPTIONS: '--require unrelated-hook',
    ANUBIS_WEB_HOME: 'unrelated-profile'
  }), { PATH: 'node-path', SystemRoot: 'windows' })
})

test('live QA locates the existing npm CLI without invoking npx or downloading Node', async () => {
  await access(await npmCli())
})

test('live QA mutation guard requires exact identity, fingerprint, label and creation window', () => {
  const identity = { id: 'fixture-id', secret: 'a'.repeat(64) }
  const startedAt = Date.now() - 1000
  const agent = {
    id: identity.id,
    fingerprint: createHash('sha256').update(identity.secret).digest('hex'),
    label: 'unique-qa-label',
    app: 'anubis-web',
    version: '5.6.12',
    platform: process.platform,
    createdAt: startedAt
  }
  assert.equal(verifyOwned(agent, identity, agent.label, startedAt), agent)
  assert.equal(verifyOwned({ ...agent, createdAt: new Date(startedAt).toISOString() }, identity, agent.label, startedAt).id, agent.id)
  for (const change of [
    { id: 'another-device' }, { fingerprint: 'another-fingerprint' },
    { label: 'unrelated-profile' }, { app: 'desktop' }, { version: '5.6.11' },
    { createdAt: NaN }, { createdAt: Infinity }, { createdAt: null },
    { createdAt: 'invalid-date' }, { createdAt: Date.now() + 60000 },
    { createdAt: startedAt - 6000 },
    { createdAt: new Date(startedAt - 6000).toISOString() }
  ]) {
    assert.throws(() => verifyOwned({ ...agent, ...change }, identity, agent.label, startedAt))
  }
})

test('live QA failure diagnostics exclude raw errors, credentials and request queries', () => {
  const error = new Error('Authorization: Bearer private-admin-token; /common/s?token=private-jwt')
  error.name = 'TimeoutError'
  const failure = phaseFailure('mcp-tools-call', error)
  assert.match(failure.message, /phase=mcp-tools-call.*TimeoutError/)
  assert.doesNotMatch(failure.message, /private-|Authorization|\?token=/)
  assert.equal(failure.cause, undefined)
})

test('admin teardown drains delayed authorized routes before browser close', { timeout: 30000 }, async t => {
  let browser = null
  let page = null
  let releaseResponse
  let requestStarted
  const held = new Promise(resolve => { releaseResponse = resolve })
  const started = new Promise(resolve => { requestStarted = resolve })
  const server = http.createServer(async (req, res) => {
    if (req.url === '/admin') {
      res.setHeader('content-type', 'text/html')
      res.end('<script>let token = "placeholder"; let generation = 0; let timer = setTimeout(() => {}, 60000)</script>')
      return
    }
    if (req.url !== '/api/poll') {
      res.writeHead(404).end()
      return
    }
    requestStarted()
    await held
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  t.after(async () => {
    releaseResponse()
    try {
      await stopAdminRoutes(page)
    } finally {
      await browser?.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
  page = await browser.newPage()
  let completed = false
  await page.route(base + '/api/**', async route => {
    const response = await route.fetch()
    await route.fulfill({ response })
    completed = true
  })
  await page.goto(base + '/admin')
  const request = page.evaluate('fetch("/api/poll").then(response => response.status)')
  await started
  let drained = false
  const draining = stopAdminRoutes(page).then(() => { drained = true })
  await page.waitForFunction('token === "" && generation === 1')
  assert.equal(drained, false, 'Unrouting must wait for the active authorized request')
  assert.equal(completed, false)
  releaseResponse()
  assert.equal(await request, 200)
  await draining
  assert.equal(completed, true)
  assert.equal(drained, true)
})

async function runLive (t, phase) {
  const adminToken = process.env.ANUBIS_MANAGED_ADMIN_TOKEN
  assert.ok(adminToken, 'ANUBIS_MANAGED_ADMIN_TOKEN is required only in the Node QA process')
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0')
  const npm = await npmCli()
  const directory = await mkdtemp(join(tmpdir(), 'anubis-web-live-'))
  const home = join(directory, 'private-home')
  const prefix = join(directory, 'installed')
  const identityFile = join(home, 'data', 'managed-installation.json')
  const label = `Anubis Web QA ${randomBytes(12).toString('hex')}`
  const startedAt = Date.now()
  let identity
  let app = null
  let browser = null
  let adminPage = null
  let revoked = false
  let revoking = false
  const sockets = new Set()
  const streams = new Set()

  async function admin (path, method = 'GET') {
    const response = await fetch(origin + path, {
      method,
      headers: { authorization: `Bearer ${adminToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    })
    assert.equal(response.status, 200, `Management ${method} ${path} failed`)
    return response.json()
  }
  async function owned () {
    const inventory = await admin('/api/agents')
    const found = inventory.agents.find(agent => agent.id === identity.id)
    assert.ok(found, 'Exact QA installation missing from inventory')
    return verifyOwned(found, identity, label, startedAt)
  }

  t.after(async () => {
    t.diagnostic('[live QA] cleanup: exact-identity revocation and private process/profile cleanup')
    const failures = []
    try {
      await stopAdminRoutes(adminPage)
    } catch (error) {
      failures.push(phaseFailure('cleanup-admin-routes', error))
    }
    try {
      if (!identity) {
        try {
          identity = JSON.parse(await readFile(identityFile, 'utf8'))
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
      if (identity && !revoked) {
        const agent = await owned()
        if (agent.status !== 'revoked') {
          await admin(`/api/agents/${identity.id}/revoke`, 'POST')
        }
        assert.equal((await owned()).status, 'revoked')
        revoked = true
      }
    } catch (error) {
      failures.push(error)
    }
    for (const socket of sockets) socket.terminate()
    for (const stream of streams) stream.destroy()
    try {
      await browser?.close()
    } catch (error) {
      failures.push(error)
    }
    try {
      if (app && app.exitCode === null && app.signalCode === null) {
        const stopped = once(app, 'exit', { signal: AbortSignal.timeout(15000) })
        app.kill()
        await stopped
      }
    } catch (error) {
      failures.push(error)
    }
    if (!failures.length) {
      await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    } else {
      t.diagnostic(`Cleanup failed; private QA profile retained at ${directory}; installation=${identity?.id || 'not created'}`)
      throw new AggregateError(failures, 'QA cleanup incomplete; do not revoke any other registration')
    }
  })

  const installEnv = childEnvironment(process.env)
  const env = {
    ...installEnv,
    ANUBIS_WEB_HOME: home,
    ANUBIS_INSTALLATION_LABEL: label,
    MCP_TOKEN: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1',
    PORT: String(await reservePort())
  }
  assert.ok(!('ANUBIS_MANAGED_ADMIN_TOKEN' in env) && !('ADMIN_TOKEN' in env))
  phase('published-package-install', registry)
  await run(process.execPath, [
    npm, 'install', '--prefix', prefix, '--omit=dev',
    '--legacy-peer-deps', '--no-audit', '--no-fund', '--registry=' + registry, 'anubis-web@5.6.12'
  ], { cwd: directory, env: installEnv, timeout: 240000, maxBuffer: 10 * 1024 * 1024 })
  const packageRoot = join(prefix, 'node_modules', 'anubis-web')
  const cli = join(packageRoot, 'npm', 'anubis-web.js')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '5.6.12')
  assert.equal(manifest.dependencies['@ai-security-tool/managed-access'], '1.0.1')
  assert.equal(manifest.devDependencies['@ai-security-tool/electerm-react'], '5.6.11')
  const require = createRequire(join(packageRoot, 'package.json'))
  const sdkRequire = createRequire(require.resolve('@ai-security-tool/managed-access'))
  const { WebSocket } = sdkRequire('ws')
  phase('private-cli-init', origin)
  await run(process.execPath, [cli, '--init'], {
    cwd: directory, env: { ...installEnv, ANUBIS_WEB_HOME: home }
  })
  const settings = parse(await readFile(join(home, '.env'), 'utf8'))
  assert.equal(settings.ANUBIS_MANAGED_URL, origin)
  assert.equal(settings.ENABLE_AUTH, '1')
  assert.ok(settings.SERVER_PASS.length >= 16 && settings.SERVER_SECRET.length === 64)
  phase('cli-default-agent-pending', origin + '/api/agents/enroll')
  app = spawn(process.execPath, [cli], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [app.stdout, app.stderr]) {
    stream.on('data', chunk => { output = (output + chunk).slice(-131072) })
  }
  await waitFor(async () => {
    assert.equal(app.exitCode, null, 'Installed QA CLI exited')
    try {
      identity = JSON.parse(await readFile(identityFile, 'utf8'))
      return true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  }, 'Installed CLI did not persist its real managed identity')
  const fingerprint = createHash('sha256').update(identity.secret).digest('hex')
  t.diagnostic(`QA installation=${identity.id}; fingerprint=${fingerprint}; startedAt=${new Date(startedAt).toISOString()}`)
  await waitFor(() => output.includes(`[managed] pending; installation=${identity.id}; fingerprint=${fingerprint}`),
    'CLI did not report its actual pending fingerprint')
  assert.ok(!output.includes(identity.secret) && !output.includes(adminToken) && !output.includes(env.MCP_TOKEN))
  phase('pending-ownership-guard', origin + '/api/agents')
  assert.equal((await owned()).status, 'pending')
  assert.equal((await owned()).online, false)

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  phase('admin-ui-signin', origin + '/admin')
  adminPage = await context.newPage()
  // The UI gets a placeholder; only Node-side HTTP requests receive the real token.
  await adminPage.route(origin + '/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const read = request.method() === 'GET' && ['/api/agents', '/api/installs'].includes(path)
    const change = request.method() === 'POST' &&
      ['approve', 'connect', 'mcp-token', 'revoke'].some(action => path === `/api/agents/${identity.id}/${action}`)
    assert.ok(read || change, 'Refusing an unrelated admin UI operation')
    if (change) await owned()
    let response
    try {
      response = await route.fetch({
        headers: { ...request.headers(), authorization: `Bearer ${adminToken}` },
        maxRedirects: 0,
        timeout: 15000
      })
    } catch (error) {
      throw phaseFailure('admin-ui-node-authorized-http', error)
    }
    if (change) t.diagnostic(`[live QA] admin UI POST ${origin}${path} => ${response.status()}`)
    await route.fulfill({ response })
  })
  assert.equal((await adminPage.goto(origin + '/admin')).status(), 200)
  await adminPage.locator('#token').fill('node-qa-authorized-request')
  await adminPage.locator('#sign-in').click()
  const row = adminPage.locator('#agent-rows tr').filter({ hasText: identity.id })
  await row.waitFor()
  assert.equal(await row.locator('code').textContent(), fingerprint)
  phase('admin-ui-approve', origin + `/api/agents/${identity.id}/approve`)
  await row.getByRole('checkbox').check()
  await row.getByRole('button', { name: 'Approve', exact: true }).click()
  phase('actual-tunnel-online', origin + '/api/agents')
  await waitFor(async () => {
    const agent = await owned()
    return agent.status === 'approved' && agent.online
  }, 'Approved installation did not establish its actual tunnel')
  await adminPage.locator('#refresh').click()
  const open = row.getByRole('button', { name: 'Open device', exact: true })
  await waitFor(() => open.isEnabled(), 'Admin UI did not enable actual online device')
  const popup = context.waitForEvent('page')
  phase('admin-ui-open-device', origin + `/api/agents/${identity.id}/connect`)
  await open.click()
  const device = await popup
  const deviceOrigin = `https://device-${identity.id.replace(/-/g, '')}.anubis.locker`
  await device.waitForURL(deviceOrigin + '/')
  await device.waitForLoadState('domcontentloaded')
  phase('gateway-cookie-and-web-jwt-boundary', deviceOrigin + '/api/get-constants')
  const cookie = (await context.cookies(deviceOrigin)).find(item => item.name === '__Host-anubis-gateway')
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict')
  const cookieHeader = `${cookie.name}=${cookie.value}`
  assert.equal(await device.evaluate(async () => (await fetch('/api/get-constants')).status), 401)
  assert.equal(await device.evaluate(async () => (await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'incorrect-live-qa-password' })
  })).status), 401)
  phase('independent-web-password-login', deviceOrigin + '/api/login')
  await device.locator('input[type="password"]').fill(settings.SERVER_PASS)
  await device.locator('input[type="password"]').press('Enter')
  await device.waitForFunction(() => window.store?.configLoaded)
  phase('shared-browser-ui', deviceOrigin)
  assert.deepEqual(await device.evaluate(() => [window.et.packInfo.version, window.et.version]), ['5.6.12', '5.6.11'])
  assert.equal(await device.locator('.sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 248)
  const title = 'Live QA terminal ' + randomBytes(6).toString('hex')
  phase('actual-terminal-command', deviceOrigin)
  await device.evaluate(title => window.store.addTab({ type: 'local', title, pane: 'terminal' }), title)
  const input = device.locator('.session-current .xterm-helper-textarea')
  await input.waitFor()
  await device.waitForFunction(platform => {
    const text = document.querySelector('.session-current .xterm-rows')?.innerText || ''
    return platform === 'win32' ? /PS [^\r\n]*>/.test(text) : /[%$#] /.test(text)
  }, process.platform)
  await input.focus()
  await device.keyboard.insertText('node -p "\'ANUBIS_\'+\'LIVE_QA_TERMINAL_OK\'"')
  await device.keyboard.press('Enter')
  await device.waitForFunction(() =>
    document.querySelector('.session-current .xterm-rows')?.innerText.includes('ANUBIS_LIVE_QA_TERMINAL_OK'))

  phase('authenticated-remote-widget-start', deviceOrigin + '/common/s')
  const mcpPort = await reservePort()
  // Normal widget management returns its key to the authorized UI/gateway.
  // Keep the same live renderer as owner; return no serverInfo to QA output.
  const widgetId = await device.evaluate(async port => {
    const result = await window.store.runWidget('mcp-server', { host: '127.0.0.1', port })
    return result.instanceId
  }, mcpPort)
  assert.ok(widgetId)
  assert.equal((await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { signal: AbortSignal.timeout(10000) })).status, 401)
  phase('admin-ui-mcp-grant', origin + `/api/agents/${identity.id}/mcp-token`)
  await row.getByRole('button', { name: 'MCP access', exact: true }).click()
  await adminPage.locator('#mcp-access').waitFor({ state: 'visible' })
  const credentials = await adminPage.locator('#mcp-credentials').textContent()
  const grant = /^Authorization: Bearer ([0-9a-f]{64})$/m.exec(credentials)?.[1]
  assert.ok(grant && grant !== env.MCP_TOKEN && grant !== identity.secret && !credentials.includes(env.MCP_TOKEN))
  const mcpUrl = deviceOrigin + '/mcp'
  assert.ok(credentials.includes('URL: ' + mcpUrl))
  async function request (path, { method = 'GET', headers = {}, body } = {}) {
    return fetch(deviceOrigin + path, {
      method,
      headers,
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30000)
    })
  }
  const grantHeaders = { authorization: `Bearer ${grant}` }
  phase('mcp-grant-scope', mcpUrl)
  assert.equal((await request('/', { headers: grantHeaders })).status, 401)
  assert.equal((await request('/mcp/other', { headers: grantHeaders })).status, 401)
  assert.equal((await fetch(origin + '/api/agents', {
    headers: grantHeaders, redirect: 'error', signal: AbortSignal.timeout(15000)
  })).status, 401)
  async function mcp (body, session) {
    return request('/mcp', {
      method: 'POST',
      headers: {
        ...grantHeaders,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {})
      },
      body
    })
  }
  phase('mcp-initialize', mcpUrl)
  const initialized = await mcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'anubis-web-live-qa', version: '1' } }
  })
  assert.equal(initialized.status, 200)
  assert.equal((await initialized.json()).result.protocolVersion, '2025-11-25')
  const session = initialized.headers.get('mcp-session-id')
  assert.ok(session)
  phase('mcp-initialized-notification', mcpUrl)
  assert.equal((await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, session)).status, 202)
  phase('mcp-tools-list', mcpUrl)
  const listed = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session)
  assert.equal(listed.status, 200)
  assert.ok((await listed.json()).result.tools.some(tool => tool.name === 'list_electerm_tabs'))
  phase('mcp-tools-call-listtabs', mcpUrl)
  const called = await mcp({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_electerm_tabs', arguments: {} }
  }, session)
  assert.equal(called.status, 200)
  const result = await called.text()
  assert.ok(result.includes(title) && !result.includes(env.MCP_TOKEN) && !result.includes(identity.secret))

  phase('mcp-active-sse', mcpUrl)
  let sseClosed = false
  await new Promise((resolve, reject) => {
    const stream = https.get(mcpUrl, {
      headers: { ...grantHeaders, accept: 'text/event-stream', 'mcp-session-id': session },
      rejectUnauthorized: true
    }, response => {
      streams.add(response)
      response.on('close', () => { sseClosed = true })
      response.on('error', error => { if (!revoking) reject(error) })
      if (response.statusCode !== 200) return reject(new Error('Live MCP SSE rejected'))
      response.once('data', chunk => {
        try {
          assert.match(chunk.toString(), /: ping/)
          stream.setTimeout(0)
          resolve()
        } catch (error) { reject(error) }
      })
      phase('web-jwt-rpc-login', deviceOrigin + '/api/login')
    })
    streams.add(stream)
    stream.on('error', reject)
    stream.setTimeout(20000, () => stream.destroy(new Error('Live MCP SSE did not stream')))
  })
  const login = await request('/api/login', {
    method: 'POST',
    headers: { cookie: cookieHeader, 'content-type': 'application/json' },
    body: { password: settings.SERVER_PASS }
  })
  assert.equal(login.status, 200)
  const jwt = await login.text()
  phase('active-authenticated-rpc', deviceOrigin + '/common/s')
  const socket = new WebSocket(deviceOrigin.replace('https:', 'wss:') + '/common/s?token=' + encodeURIComponent(jwt), {
    headers: { cookie: cookieHeader }, rejectUnauthorized: true, handshakeTimeout: 15000
  })
  sockets.add(socket)
  let wsClosed = false
  socket.on('close', () => { wsClosed = true })
  socket.on('error', error => { if (!revoking) t.diagnostic('QA RPC socket error: ' + error.code) })
  await once(socket, 'open', { signal: AbortSignal.timeout(20000) })
  const reply = once(socket, 'message', { signal: AbortSignal.timeout(15000) })
  socket.send(JSON.stringify({ id: 'live-qa', action: 'runSync', func: 'getScreenSize' }))
  assert.equal(JSON.parse((await reply)[0].toString()).id, 'live-qa')
  assert.equal(wsClosed, false)
  assert.equal(sseClosed, false)
  revoking = true
  await owned()
  phase('admin-ui-revoke', origin + `/api/agents/${identity.id}/revoke`)
  await adminPage.locator('#refresh').click()
  await row.getByRole('button', { name: 'Revoke', exact: true }).click()
  await row.getByRole('button', { name: 'Confirm revoke', exact: true }).click()
  await waitFor(async () => (await owned()).status === 'revoked', 'QA registration was not revoked')
  revoked = true
  phase('revoked-active-streams', deviceOrigin)
  await waitFor(() => wsClosed && sseClosed, 'Revocation did not close active gateway WS and MCP SSE', 20000)
  assert.equal((await owned()).online, false)
  phase('revoked-cookie', deviceOrigin)
  assert.equal((await request('/', { headers: { cookie: cookieHeader } })).status, 401)
  phase('revoked-mcp-grant', mcpUrl)
  assert.equal((await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, session)).status, 401)
  assert.ok(!output.includes(adminToken) && !output.includes(identity.secret) && !output.includes(env.MCP_TOKEN))
  phase('drain-authorized-admin-routes', origin + '/admin')
  await stopAdminRoutes(adminPage)
  t.diagnostic(`QA functional checks complete; revoked exact installation=${identity.id}; final process/profile cleanup pending`)
}

test('published installed Web uses native HTTPS gateway, independent login, terminal and scoped MCP', {
  skip: process.env.ANUBIS_MANAGED_LIVE !== '1',
  timeout: 600000
}, async t => {
  const started = Date.now()
  let currentPhase = 'preflight'
  const phase = (name, target) => {
    currentPhase = name
    const url = new URL(target)
    t.diagnostic(`[live QA] phase=${name}; target=${url.origin}${url.pathname}; elapsedMs=${Date.now() - started}`)
  }
  try {
    await runLive(t, phase)
  } catch (error) {
    throw phaseFailure(currentPhase, error)
  }
})
