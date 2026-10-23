import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { startManagedAccess, probeLocalServer } from '../../src/app/lib/managed-access.js'

const env = {
  NODE_ENV: 'production',
  ANUBIS_MANAGED_URL: 'https://api.example.test',
  SERVER_SECRET: 'managed-test-secret-not-a-production-key',
  SERVER_PASS: 'managed-test-password-not-a-production-password'
}

async function listener (t, status = 200) {
  const server = http.createServer((req, res) => {
    res.writeHead(status)
    res.end('local fixture')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  return server
}

test('standalone startup never constructs an agent', async () => {
  assert.equal(await startManagedAccess({
    env: {},
    createAgent: () => assert.fail('Standalone mode must not enroll')
  }), null)
})

test('managed startup uses actual listener and minimal metadata; stop is idempotent', async t => {
  const server = await listener(t)
  let options
  let starts = 0
  let stops = 0
  const onStatus = () => {}
  const managed = await startManagedAccess({
    server,
    env: { ...env, SSH_PASSWORD: 'must-not-leave-local-process', USERNAME: 'private-user' },
    version: '5.6.11',
    onStatus,
    createAgent: conf => {
      options = conf
      return {
        start: async () => { starts++ },
        stop: async () => { stops++ }
      }
    }
  })
  assert.equal(starts, 1)
  assert.equal(options.localHost, '127.0.0.1')
  assert.equal(options.localPort, server.address().port)
  assert.equal(options.onStatus, onStatus)
  assert.equal(await options.probe(), true)
  assert.deepEqual(Object.keys(options).sort(), [
    'app', 'baseUrl', 'identityFile', 'label', 'localHost', 'localPort',
    'onStatus', 'probe', 'version'
  ])
  await Promise.all([managed.stop(), managed.stop()])
  assert.equal(stops, 1)
})

test('listener closure stops agent and health failure prevents enrollment', async t => {
  const server = await listener(t)
  let stopped
  const didStop = new Promise(resolve => { stopped = resolve })
  await startManagedAccess({
    server,
    env,
    createAgent: () => ({ start () {}, stop: stopped })
  })
  server.close()
  await didStop
  const unavailable = await listener(t, 503)
  assert.equal(await probeLocalServer(unavailable.address().port), false)
  await assert.rejects(startManagedAccess({
    server: unavailable,
    env,
    createAgent: () => assert.fail('Must not publish a failed listener')
  }), /unavailable on loopback/)
})

test('failed agent startup cleans up before surfacing the error', async t => {
  const server = await listener(t)
  let stops = 0
  await assert.rejects(startManagedAccess({
    server,
    env,
    createAgent: () => ({
      start () { throw new Error('fixture gateway failure') },
      stop () { stops++ }
    })
  }), /fixture gateway failure/)
  assert.equal(stops, 1)
})
