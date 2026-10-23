import { randomBytes } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { managedConfig } from '../src/app/lib/managed-config.js'

export const defaultManagedOrigin = 'https://api.anubis.locker'

export function prepareManagedEnvironment (env) {
  env.NODE_ENV = 'production'
  if (env.ANUBIS_MANAGED_ACCESS === '0') {
    // Preserve the opt-out if another startup module loads dotenv again.
    env.ANUBIS_MANAGED_URL = ''
  } else {
    env.ANUBIS_MANAGED_URL ||= defaultManagedOrigin
  }
  return env
}

export async function configureManagedInstallation ({
  directory = process.cwd(),
  templateFile = resolve(directory, '.sample.env'),
  env = process.env,
  log = console
} = {}) {
  const filename = resolve(directory, '.env')
  try {
    await readFile(filename)
    log.info('[anubis] Existing .env preserved, including credentials and managed/standalone settings.')
    return false
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const configured = prepareManagedEnvironment({
    ANUBIS_MANAGED_ACCESS: env.ANUBIS_MANAGED_ACCESS,
    ANUBIS_MANAGED_URL: env.ANUBIS_MANAGED_URL,
    ENABLE_AUTH: '1',
    SERVER_SECRET: randomBytes(32).toString('hex'),
    SERVER_PASS: randomBytes(24).toString('base64url')
  })
  managedConfig(configured, directory)
  let text = await readFile(templateFile, 'utf8')
  const settings = {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    ENABLE_AUTH: '1',
    SERVER_SECRET: configured.SERVER_SECRET,
    SERVER_PASS: configured.SERVER_PASS,
    ANUBIS_MANAGED_ACCESS: configured.ANUBIS_MANAGED_URL ? '1' : '0',
    ...(configured.ANUBIS_MANAGED_URL ? { ANUBIS_MANAGED_URL: configured.ANUBIS_MANAGED_URL } : {})
  }
  for (const [key, value] of Object.entries(settings)) {
    const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm')
    text = pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : `${text}\n${key}=${value}\n`
  }
  const file = await open(filename, 'wx', 0o600)
  try {
    await file.writeFile(text)
    await file.sync()
  } finally {
    await file.close()
  }
  log.info(`[anubis] Created private ${filename} with unique strong Web login credentials.`)
  log.info(configured.ANUBIS_MANAGED_URL
    ? `[anubis] Managed gateway: ${configured.ANUBIS_MANAGED_URL}; first fingerprint approval is required.`
    : '[anubis] Standalone mode explicitly selected; no managed enrollment.')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  configureManagedInstallation().catch(error => {
    console.error('[anubis] Failed to configure installation:', error.message)
    process.exitCode = 1
  })
}
