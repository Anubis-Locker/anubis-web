import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, populate } from 'dotenv'
import {
  configureManagedInstallation,
  prepareManagedEnvironment
} from '../../scripts/configure-managed.js'
import { managedConfig } from '../../src/app/lib/managed-config.js'

async function fixture (t) {
  const directory = await mkdtemp(join(tmpdir(), 'anubis-managed-install-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await copyFile(new URL('../../.sample.env', import.meta.url), join(directory, '.sample.env'))
  return directory
}

test('fresh source installations default to own gateway with unique strong local authentication', async t => {
  const directory = await fixture(t)
  const messages = []
  await configureManagedInstallation({ directory, env: {}, log: { info: text => messages.push(text) } })
  const env = parse(await readFile(join(directory, '.env')))
  assert.equal(env.NODE_ENV, 'production')
  assert.equal(env.HOST, '127.0.0.1')
  assert.equal(env.ENABLE_AUTH, '1')
  assert.equal(env.ANUBIS_MANAGED_URL, 'https://api.anubis.locker')
  assert.equal(env.ANUBIS_MANAGED_ACCESS, '1')
  assert.equal(env.SERVER_SECRET.length, 64)
  assert.equal(env.SERVER_PASS.length, 32)
  assert.equal(managedConfig(env).origin, 'https://api.anubis.locker')
  assert.equal(messages.join('').includes(env.SERVER_PASS), false)
  assert.equal(messages.join('').includes(env.SERVER_SECRET), false)
  const other = await fixture(t)
  await configureManagedInstallation({ directory: other, env: {}, log: { info () {} } })
  const second = parse(await readFile(join(other, '.env')))
  assert.notEqual(second.SERVER_SECRET, env.SERVER_SECRET)
  assert.notEqual(second.SERVER_PASS, env.SERVER_PASS)
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(directory, '.env'))).mode & 0o777, 0o600)
  }
})

test('explicit standalone selection does not enroll and existing settings are never overwritten', async t => {
  const directory = await fixture(t)
  const log = { info () {} }
  await configureManagedInstallation({ directory, env: { ANUBIS_MANAGED_ACCESS: '0' }, log })
  const filename = join(directory, '.env')
  const original = await readFile(filename, 'utf8')
  const env = parse(original)
  assert.equal(env.ANUBIS_MANAGED_ACCESS, '0')
  assert.equal(env.ANUBIS_MANAGED_URL, undefined)
  assert.equal(managedConfig(prepareManagedEnvironment(env)), null)
  assert.equal(await configureManagedInstallation({ directory, env: {}, log }), false)
  assert.equal(await readFile(filename, 'utf8'), original)
  await writeFile(filename, 'ENABLE_AUTH=0\nSERVER_PASS=legacy-private-config\n')
  assert.equal(await configureManagedInstallation({ directory, env: {}, log }), false)
  assert.equal(await readFile(filename, 'utf8'), 'ENABLE_AUTH=0\nSERVER_PASS=legacy-private-config\n')
})

test('managed source runner defaults production endpoint but respects custom origin and explicit opt-out', () => {
  assert.deepEqual(prepareManagedEnvironment({}), {
    NODE_ENV: 'production', ANUBIS_MANAGED_URL: 'https://api.anubis.locker'
  })
  assert.equal(prepareManagedEnvironment({ ANUBIS_MANAGED_URL: 'https://private.example.test' }).ANUBIS_MANAGED_URL,
    'https://private.example.test')
  const standalone = prepareManagedEnvironment({
    ANUBIS_MANAGED_ACCESS: '0', ANUBIS_MANAGED_URL: 'https://api.anubis.locker'
  })
  assert.equal(standalone.ANUBIS_MANAGED_URL, '')
  populate(standalone, { ANUBIS_MANAGED_URL: 'https://api.anubis.locker', ANUBIS_MANAGED_ACCESS: '1' })
  assert.equal(standalone.ANUBIS_MANAGED_URL, '')
  assert.equal(managedConfig(standalone), null)
})

test('insecure installer gateway override fails without creating configuration', async t => {
  const directory = await fixture(t)
  await assert.rejects(configureManagedInstallation({
    directory, env: { ANUBIS_MANAGED_URL: 'http://untrusted.example.test' }
  }), /HTTPS origin/)
  await assert.rejects(readFile(join(directory, '.env')), { code: 'ENOENT' })
})
