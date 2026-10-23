/**
 * app entry
 */

import log from './common/log.js'
import { createApp } from './server/server.js'
import { packInfo } from './common/runtime-constants.js'
import { enforceSecurityConfig } from './lib/security.js'
import { once } from 'node:events'
import { managedConfig } from './lib/managed-config.js'
import { startManagedAccess } from './lib/managed-access.js'
import { randomBytes } from 'node:crypto'

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err)
})
process.on('unhandledRejection', (err) => {
  log.error('unhandledRejection', err)
})

async function main () {
  log.info('app start')
  enforceSecurityConfig(log)
  const managed = managedConfig()
  const managedLocalAuth = managed ? randomBytes(32).toString('hex') : undefined
  const app = await createApp({ managedLocalAuth })

  const { HOST, PORT } = process.env

  const server = app.listen(PORT, HOST, () => {
    console.log(`server runs on http://${HOST}:${PORT}`)
  })
  await once(server, 'listening')
  if (managed) {
    const { createAgent } = await import('@ai-security-tool/managed-access')
    let lastStatus
    const access = await startManagedAccess({
      server,
      createAgent,
      version: packInfo.version,
      localAuth: managedLocalAuth,
      onStatus: state => {
        const key = JSON.stringify([state.status, state.url, state.error])
        if (lastStatus === key) return
        lastStatus = key
        console.info(`[managed] ${state.status}; installation=${state.id}; fingerprint=${state.fingerprint}${state.url ? '; url=' + state.url : ''}`)
        if (state.error) log.error('[managed]', state.error)
      }
    })
    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      try {
        await access.stop()
        server.close()
        process.exit(0)
      } catch (error) {
        log.error('Failed to stop managed access:', error)
        process.exit(1)
      }
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  }
}

// main() is async, so anything thrown inside it (a failed import, an
// unreadable config, a bad platform integration) used to surface only as an
// UnhandledPromiseRejection while the server silently never listened.
// Fail loudly instead, so the next one of these is diagnosable from the
// message and a process supervisor can restart it.
main().catch((err) => {
  log.error(`Failed to start ${packInfo.name}:`, err)
  process.exit(1)
})
