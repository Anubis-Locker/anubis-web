import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { managedConfig } from '../../src/app/lib/managed-config.js'

const env = {
  NODE_ENV: 'production',
  ANUBIS_MANAGED_URL: 'https://api.example.test',
  SERVER_SECRET: 'managed-test-secret-not-a-production-key',
  SERVER_PASS: 'managed-test-password-not-a-production-password'
}

test('standalone mode remains opt-out without requiring managed credentials', () => {
  assert.equal(managedConfig({ ENABLE_AUTH: '0' }), null)
  assert.equal(managedConfig({ ...env, ANUBIS_MANAGED_ACCESS: '0' }), null)
})

test('managed mode accepts only a secure gateway origin and private state location', () => {
  const config = managedConfig(env)
  assert.equal(config.origin, 'https://api.example.test')
  assert.equal(config.identityFile, resolve('data', 'managed-installation.json'))
  assert.equal(managedConfig({ ...env, DB_PATH: 'private-data' }).identityFile,
    resolve('private-data', 'managed-installation.json'))
  for (const url of [
    'http://api.example.test',
    'https://user:pass@api.example.test',
    'https://api.example.test/other',
    'https://api.example.test?token=secret',
    'https://api.example.test/#fragment'
  ]) {
    assert.throws(() => managedConfig({ ...env, ANUBIS_MANAGED_URL: url }))
  }
})

test('managed mode refuses missing, disabled, or weak authentication in every environment', () => {
  for (const invalid of [
    { ENABLE_AUTH: 'false' },
    { SERVER_PASS: '' },
    { SERVER_PASS: 'admin' },
    { SERVER_PASS: 'x' },
    { SERVER_SECRET: '' },
    { SERVER_SECRET: 'secret' }
  ]) {
    assert.throws(() => managedConfig({ ...env, ...invalid, NODE_ENV: 'development' }),
      /requires authentication/)
  }
  assert.throws(() => managedConfig({ ...env, SERVER: 'http://localhost:5577' }),
    /same-origin/)
  assert.throws(() => managedConfig({ ...env, NODE_ENV: 'development' }),
    /built browser assets/)
})
