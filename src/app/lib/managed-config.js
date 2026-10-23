import { resolve } from 'node:path'
import { checkSecurityConfig } from './security.js'

export function managedConfig (env = process.env, cwd = process.cwd()) {
  if (env.ANUBIS_MANAGED_ACCESS === '0' || !env.ANUBIS_MANAGED_URL) return null
  const url = new URL(env.ANUBIS_MANAGED_URL)
  if (
    url.protocol !== 'https:' ||
    url.username || url.password || url.search || url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('ANUBIS_MANAGED_URL must be an HTTPS origin without credentials')
  }
  const { errors, warnings } = checkSecurityConfig({ ...env, NODE_ENV: 'production' })
  if (errors.length || warnings.length || env.SERVER_PASS.length < 16) {
    throw new Error('Managed access requires authentication with a strong SERVER_SECRET and SERVER_PASS')
  }
  if (env.NODE_ENV !== 'production') {
    throw new Error('Managed access requires NODE_ENV=production and built browser assets')
  }
  if (env.SERVER || env.CDN) {
    throw new Error('Managed access requires same-origin browser assets: unset SERVER and CDN')
  }
  return {
    origin: url.origin,
    identityFile: resolve(
      cwd,
      env.ANUBIS_INSTALLATION_FILE ||
      resolve(env.DB_PATH || resolve(cwd, 'data'), 'managed-installation.json')
    )
  }
}
