import http from 'node:http'
import { managedConfig } from './managed-config.js'

export function probeLocalServer (port) {
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/',
      timeout: 5000,
      agent: false
    }, response => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.on('timeout', () => request.destroy(new Error('Local probe timed out')))
    request.on('error', () => resolve(false))
  })
}

export async function startManagedAccess ({
  server,
  createAgent,
  version,
  localAuth,
  env = process.env,
  onStatus
}) {
  const config = managedConfig(env)
  if (!config) return null
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Managed access requires a listening TCP server')
  }
  if (!await probeLocalServer(address.port)) {
    throw new Error('Managed access local HTTP server is unavailable on loopback')
  }
  const agent = createAgent({
    baseUrl: config.origin,
    identityFile: config.identityFile,
    label: env.ANUBIS_INSTALLATION_LABEL || 'Anubis Web',
    app: 'anubis-web',
    version,
    localHost: '127.0.0.1',
    localPort: address.port,
    probe: () => probeLocalServer(address.port),
    ...(localAuth ? { localHeaders: { 'x-anubis-managed-auth': localAuth } } : {}),
    onStatus
  })
  let stopping
  const stop = () => {
    if (!stopping) {
      server.off('close', onClose)
      stopping = Promise.resolve().then(() => agent.stop())
    }
    return stopping
  }
  const onClose = () => {
    stop().catch(error => onStatus?.({ status: 'error', error }))
  }
  server.once('close', onClose)
  try {
    await agent.start()
    if (!server.listening) await stop()
  } catch (error) {
    await stop()
    throw error
  }
  return {
    stop: () => {
      server.off('close', onClose)
      return stop()
    }
  }
}
