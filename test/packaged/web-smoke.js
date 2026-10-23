import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { once } from 'node:events'
import { chromium } from 'playwright'

test('locally built web application authenticates, renders shared UI and executes a terminal command', { timeout: 90000 }, async t => {
  const data = mkdtempSync(join(tmpdir(), 'anubis-web-smoke-'))
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const password = randomBytes(24).toString('hex')
  const server = spawn(process.execPath, ['src/app/app.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DB_PATH: data,
      DB_TYPE: 'sqlite',
      ENABLE_AUTH: '1',
      SERVER_SECRET: randomBytes(32).toString('hex'),
      SERVER_PASS: password
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { output += chunk })
  }
  let browser = null
  t.after(async () => {
    if (browser) await browser.close()
    if (server.exitCode === null) {
      const exited = once(server, 'exit')
      server.kill()
      await exited
    }
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })
  const url = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Web server exited: ${output}`)
    try {
      const response = await fetch(url)
      assert.equal(response.status, 200, output)
      ready = true
      break
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error
      await delay(100)
    }
  }
  assert.ok(ready, `Web server did not become ready: ${output}`)
  const denied = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'incorrect-fixture-password' })
  })
  assert.equal(denied.status, 401)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure().errorText}`))
  await page.goto(url)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('input[type="password"]').press('Enter')
  await page.waitForFunction(() => window.store?.configLoaded)
  const sync = await page.evaluate(() => window.store.config.syncSetting)
  assert.equal(sync.autoSync, true)
  assert.equal(sync.cloudApiUrl, 'https://sync.anubis.locker/api/sync')
  assert.equal(await page.locator('.sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 248)
  await page.locator('.control-icon-wrap[title="Setting"]').click()
  for (const name of ['bookmarks', 'setting', 'terminalThemes', 'quickCommands', 'triggers', 'profiles', 'widgets']) {
    await page.locator(`.setting-tabs [data-node-key="${name}"] [role="tab"]`).click()
    await page.waitForFunction(() => !document.querySelector('.ant-spin-spinning'))
  }
  await page.locator('.close-setting-wrap:visible').first().click()
  await page.evaluate(() => window.store.addTab({ type: 'local', title: 'Web terminal smoke', pane: 'terminal' }))
  await page.locator('.session-current .xterm-helper-textarea').waitFor()
  await page.locator('.session-current .xterm-helper-textarea').focus()
  await page.keyboard.insertText('node -p "\'ANUBIS_\'+\'WEB_TERMINAL_OK\'"')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.body.innerText.includes('ANUBIS_WEB_TERMINAL_OK'))
  assert.deepEqual(errors, [])
  assert.doesNotMatch(output, /\berror [›>]|uncaughtException|unhandledRejection/)
})
