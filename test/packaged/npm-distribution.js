import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import net from 'node:net'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { parse } from 'dotenv'
import { chromium } from 'playwright'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { x as extract } from 'tar'

const run = promisify(execFile)

test('own-registry installed Web tarball CLI starts outside checkout and authenticates the shared browser', { timeout: 240000 }, async t => {
  assert.ok(process.env.npm_execpath, 'Run this fixture with npm run test-distribution')
  const directory = await mkdtemp(join(tmpdir(), 'anubis-web-distribution-'))
  let server = null
  let browser = null
  let unavailableGateway = null
  let website = null
  t.after(async () => {
    await browser?.close()
    if (server && server.exitCode === null) {
      const stopped = once(server, 'exit')
      server.kill()
      await stopped
    }
    if (unavailableGateway) {
      unavailableGateway.closeAllConnections()
      await new Promise(resolve => unavailableGateway.close(resolve))
    }
    if (website) {
      website.closeAllConnections()
      await new Promise(resolve => website.close(resolve))
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })
  const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const npmEnv = { ...process.env, NPM_REGISTRY_URL: 'https://npm.anubis.locker/' }
  const tarball = process.env.ANUBIS_WEB_TARBALL
    ? resolve(process.env.ANUBIS_WEB_TARBALL)
    : join(directory, `${manifest.name}-${manifest.version}.tgz`)
  if (!process.env.ANUBIS_WEB_TARBALL) {
    await run(process.execPath, [
      process.env.npm_execpath, 'pack', '--pack-destination', directory, '--ignore-scripts'
    ], { env: npmEnv, timeout: 30000 })
  }
  if (process.env.ANUBIS_WEB_EXPECT_PRIVATE === '1') {
    await t.test('extracted candidate supports production npm ci without source/dev renderer', async () => {
      const extracted = join(directory, 'ci')
      await mkdir(extracted)
      await extract({ file: tarball, cwd: extracted })
      const root = join(extracted, 'package')
      await run(process.execPath, [
        process.env.npm_execpath, 'ci', '--omit=dev', '--legacy-peer-deps',
        '--no-audit', '--no-fund', '--registry=https://npm.anubis.locker/'
      ], { cwd: root, env: npmEnv, timeout: 180000, maxBuffer: 10 * 1024 * 1024 })
      await assert.rejects(access(join(root, 'node_modules', '@ai-security-tool', 'electerm-react')), { code: 'ENOENT' })
      const home = join(directory, 'ci-check-private-home')
      const checked = await run(process.execPath, [join(root, 'npm', 'anubis-web.js'), '--check'], {
        cwd: extracted, env: { ...npmEnv, ANUBIS_WEB_HOME: home }
      })
      assert.match(checked.stdout, /Production Web payload ready/)
      await assert.rejects(access(home), { code: 'ENOENT' })
      await assert.rejects(access(join(root, '.env')), { code: 'ENOENT' })
      await assert.rejects(access(join(root, 'data')), { code: 'ENOENT' })
    })
  }
  const prefix = join(directory, 'installed')
  await run(process.execPath, [
    process.env.npm_execpath, 'install', '--prefix', prefix, '--omit=dev',
    '--legacy-peer-deps', '--no-audit', '--no-fund', '--registry=https://npm.anubis.locker/',
    tarball
  ], { env: npmEnv, timeout: 180000, maxBuffer: 10 * 1024 * 1024 })
  const packageRoot = join(prefix, 'node_modules', 'anubis-web')
  const cli = join(packageRoot, 'npm', 'anubis-web.js')
  await access(join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'anubis-web.cmd' : 'anubis-web'))
  const runtime = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(runtime.version, manifest.version)
  if (process.env.ANUBIS_WEB_EXPECT_PRIVATE === '1') assert.equal(runtime.private, true)
  assert.equal(runtime.devDependencies['@ai-security-tool/electerm-react'], manifest.devDependencies['@ai-security-tool/electerm-react'])
  await assert.rejects(access(join(packageRoot, 'src', 'client')))
  await assert.rejects(access(join(prefix, 'node_modules', '@ai-security-tool', 'electerm-react')), { code: 'ENOENT' })
  await assert.rejects(access(join(packageRoot, 'node_modules', '@ai-security-tool', 'electerm-react')), { code: 'ENOENT' })
  await assert.rejects(access(join(packageRoot, '.env')))
  await assert.rejects(access(join(packageRoot, 'data')))
  const home = join(directory, 'private-home')
  const env = { ...npmEnv, ANUBIS_WEB_HOME: home, ANUBIS_MANAGED_ACCESS: '1' }
  const version = await run(process.execPath, [cli, '--version'], { cwd: prefix, env })
  assert.equal(version.stdout.trim(), manifest.version)
  const check = await run(process.execPath, [cli, '--check'], { cwd: prefix, env })
  assert.match(check.stdout, /Production Web payload ready/)
  await assert.rejects(access(home), { code: 'ENOENT' })
  for (const name of [
    join('dist', 'views', 'index.pug'),
    join('dist', 'assets', 'js', `worker-${manifest.devDependencies['@ai-security-tool/electerm-react']}.js`)
  ]) {
    const path = join(packageRoot, name)
    const contents = await readFile(path)
    await rm(path)
    try {
      await assert.rejects(run(process.execPath, [cli, '--standalone'], { cwd: prefix, env }), error => {
        assert.match(error.stderr, /Production Web payload is not ready/)
        return true
      })
      await assert.rejects(access(home), { code: 'ENOENT' })
      const unopenedData = join(directory, 'broken-payload-data')
      await assert.rejects(run(process.execPath, [join(packageRoot, 'src', 'app', 'app.js')], {
        cwd: prefix,
        env: {
          ...env,
          NODE_ENV: 'production',
          ANUBIS_MANAGED_ACCESS: '0',
          ANUBIS_MANAGED_URL: '',
          ENABLE_AUTH: '1',
          SERVER_PASS: randomBytes(24).toString('hex'),
          SERVER_SECRET: randomBytes(32).toString('hex'),
          DB_PATH: unopenedData
        }
      }), error => {
        assert.match(error.stderr, /Production Web payload is not ready/)
        return true
      })
      await assert.rejects(access(unopenedData), { code: 'ENOENT' })
    } finally {
      await writeFile(path, contents)
    }
  }
  await run(process.execPath, [cli, '--init'], { cwd: prefix, env })
  const settings = await readFile(join(home, '.env'), 'utf8')
  const configured = parse(settings)
  assert.equal(configured.ANUBIS_MANAGED_URL, 'https://api.anubis.locker')
  assert.equal(configured.ENABLE_AUTH, '1')
  assert.ok(configured.SERVER_PASS.length >= 16)
  assert.equal(configured.SERVER_SECRET.length, 64)
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  server = spawn(process.execPath, [cli, '--standalone'], {
    cwd: prefix,
    env: {
      ...env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SERVER_PASS: configured.SERVER_PASS,
      SERVER_SECRET: configured.SERVER_SECRET,
      ENABLE_AUTH: '1',
      SERVER: '',
      CDN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { output += chunk })
  }
  const url = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Installed CLI exited: ${output}`)
    try {
      ready = (await fetch(url)).status === 200
      if (ready) break
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error
    }
    await delay(100)
  }
  assert.ok(ready, output)
  assert.equal((await fetch(url + '/mcp')).status, 404)
  assert.equal((await fetch(url + '/api/get-constants')).status, 401)
  assert.equal((await fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'invalid-fixture-password' })
  })).status, 401)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure().errorText}`))
  page.on('response', response => {
    if (response.status() >= 400 && /^\/(js|chunk|css|assets|images|icons)\//.test(new URL(response.url()).pathname)) {
      errors.push(`Asset HTTP ${response.status()}: ${response.url()}`)
    }
  })
  await page.goto(url)
  assert.deepEqual(await page.evaluate(() => [window.et.packInfo.version, window.et.version]), [
    manifest.version, manifest.devDependencies['@ai-security-tool/electerm-react']
  ])
  await page.locator('input[type="password"]').fill(configured.SERVER_PASS)
  await page.locator('input[type="password"]').press('Enter')
  await page.waitForFunction(() => window.store?.configLoaded)
  assert.equal(await page.evaluate(() => window.et.isWebApp), true)
  assert.equal(await page.locator('.sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 248)
  await page.evaluate(() => window.store.addTab({ type: 'local', title: 'Installed package terminal', pane: 'terminal' }))
  const input = page.locator('.session-current .xterm-helper-textarea')
  await input.waitFor()
  await page.waitForFunction(platform => {
    const text = document.querySelector('.session-current .xterm-rows')?.innerText || ''
    return platform === 'win32' ? /PS [^\r\n]*>/.test(text) : /[%$#] /.test(text)
  }, process.platform)
  await input.focus()
  await page.keyboard.insertText('node -p "\'ANUBIS_\'+\'NPM_TERMINAL_OK\'"')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document.querySelector('.session-current .xterm-rows')?.innerText.includes('ANUBIS_NPM_TERMINAL_OK'))
  if (process.env.ANUBIS_WEB_EXPECT_PRIVATE === '1') {
    await t.test('ordinary Web website sessions use the honest iframe fallback, never native webview', async () => {
      website = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><body><h1>Owned website fixture</h1></body></html>')
      })
      website.listen(0, '127.0.0.1')
      await once(website, 'listening')
      const websiteUrl = `http://127.0.0.1:${website.address().port}/`
      await page.evaluate(url => window.store.addTab({
        type: 'web', url, title: 'Owned website fixture'
      }), websiteUrl)
      const frame = page.frameLocator('.session-current iframe')
      await frame.locator('h1').waitFor({ state: 'visible' })
      assert.equal(await frame.locator('h1').textContent(), 'Owned website fixture')
      assert.match(await page.locator('.session-current [role="note"]').textContent(), /websites block embedding/)
      assert.equal(await page.locator('.session-current webview').count(), 0)
      assert.equal(await page.evaluate(() => window.anubisWebsite?.embedded === true), false)
    })
  }
  await assert.rejects(access(join(home, 'data', 'managed-installation.json')), { code: 'ENOENT' })
  assert.doesNotMatch(output, /\[managed\]/)
  assert.deepEqual(errors, [])
  assert.ok(await readFile(join(home, '.env'), 'utf8') === settings, 'Existing private settings must be preserved')
  const existingToken = await page.evaluate(() => window.localStorage.getItem('tokenElecterm'))
  assert.ok(existingToken, 'A real browser login must create a token')
  await browser.close()
  browser = null
  const stopped = once(server, 'exit')
  server.kill()
  await stopped
  server = null
  const database = join(home, 'data', 'sqlite', 'electerm.db')
  const seed = new DatabaseSync(database)
  try {
    seed.exec("CREATE TABLE restoration_fixture(value TEXT); INSERT INTO restoration_fixture VALUES ('preserved')")
  } finally {
    seed.close()
  }
  await rm(join(home, '.env'))
  server = spawn(process.execPath, [join(packageRoot, 'src', 'app', 'app.js')], {
    cwd: home,
    env: {
      ...env,
      NODE_ENV: 'production',
      ANUBIS_MANAGED_ACCESS: '0',
      ANUBIS_MANAGED_URL: '',
      DB_PATH: join(home, 'data'),
      HOST: '127.0.0.1',
      PORT: String(port),
      ENABLE_AUTH: '1',
      SERVER_PASS: configured.SERVER_PASS,
      SERVER_SECRET: configured.SERVER_SECRET,
      SERVER: '',
      CDN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let restoredOutput = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { restoredOutput += chunk })
  }
  let restored = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Restoration entry exited: ${restoredOutput}`)
    try {
      restored = (await fetch(url)).status === 200
      if (restored) break
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error
    }
    await delay(100)
  }
  assert.ok(restored, restoredOutput)
  assert.equal((await fetch(url + '/api/get-constants', { headers: { token: existingToken } })).status, 200)
  await assert.rejects(access(join(home, '.env')), { code: 'ENOENT' })
  const restoredStopped = once(server, 'exit')
  server.kill()
  await restoredStopped
  server = null
  const preserved = new DatabaseSync(database, { readOnly: true })
  try {
    assert.equal(preserved.prepare('SELECT value FROM restoration_fixture').get().value, 'preserved')
  } finally {
    preserved.close()
  }
  await writeFile(join(home, '.env'), settings, { mode: 0o600 })
  // This fixture owns the non-TLS listener; HTTPS enrollment must fail locally.
  unavailableGateway = http.createServer()
  unavailableGateway.listen(0, '127.0.0.1')
  await once(unavailableGateway, 'listening')
  server = spawn(process.execPath, [cli], {
    cwd: prefix,
    env: {
      ...env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ANUBIS_MANAGED_URL: `https://127.0.0.1:${unavailableGateway.address().port}`,
      SERVER: '',
      CDN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let managedOutput = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { managedOutput += chunk })
  }
  for (let attempt = 0; attempt < 100 && !managedOutput.includes('[managed] offline;'); attempt++) {
    if (server.exitCode !== null) throw new Error(`Managed installed CLI exited: ${managedOutput}`)
    await delay(100)
  }
  const identity = JSON.parse(await readFile(join(home, 'data', 'managed-installation.json'), 'utf8'))
  assert.match(managedOutput, new RegExp(`\\[managed\\] offline; installation=${identity.id}; fingerprint=[0-9a-f]{64}`))
  assert.ok(!managedOutput.includes(identity.secret), 'Device credential must never appear in stdout')
  assert.doesNotMatch(managedOutput, /\[managed\] online|; url=/)
  assert.equal((await fetch(url + '/api/get-constants')).status, 401)
})
