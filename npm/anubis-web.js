#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { configureManagedInstallation, prepareManagedEnvironment } from '../scripts/configure-managed.js'
import { verifyProductionAssets } from '../src/app/lib/production-assets.js'

async function main () {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--help', '--version', '--standalone', '--init', '--check'].includes(arg))) {
    throw new Error('Unknown option; use anubis-web --help')
  }
  if (args.includes('--help')) {
    console.log('Usage: anubis-web [--standalone] [--init] [--check] [--version]')
    console.log('Managed access defaults to https://api.anubis.locker; first fingerprint approval is required.')
    console.log('ANUBIS_WEB_HOME selects private settings/data (default ~/.anubis-web). PORT overrides 5577.')
    console.log('--check validates the production payload without creating settings/data or starting a server.')
    return
  }
  if (args.includes('--version')) {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    console.log(manifest.version)
    return
  }
  const directory = resolve(process.env.ANUBIS_WEB_HOME || resolve(homedir(), '.anubis-web'))
  const loaded = config({ path: resolve(directory, '.env') })
  if (loaded.error && loaded.error.code !== 'ENOENT') throw loaded.error
  const root = fileURLToPath(new URL('../', import.meta.url))
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  await verifyProductionAssets({
    root,
    version: manifest.devDependencies['@ai-security-tool/electerm-react'],
    views: process.env.VIEW_FOLDER ? resolve(directory, process.env.VIEW_FOLDER) : undefined
  })
  if (args.includes('--check')) {
    console.log(`Production Web payload ready; runtime ${manifest.version}, renderer ${manifest.devDependencies['@ai-security-tool/electerm-react']}`)
    return
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const standalone = args.includes('--standalone')
  await configureManagedInstallation({
    directory,
    templateFile: fileURLToPath(new URL('../.sample.env', import.meta.url)),
    env: { ...process.env, ...(standalone ? { ANUBIS_MANAGED_ACCESS: '0' } : {}) }
  })
  if (args.includes('--init')) return
  config({ path: resolve(directory, '.env') })
  if (standalone) process.env.ANUBIS_MANAGED_ACCESS = '0'
  prepareManagedEnvironment(process.env)
  process.env.DB_PATH ||= resolve(directory, 'data')
  process.env.HOST ||= '127.0.0.1'
  process.env.PORT ||= '5577'
  process.chdir(directory)
  await import('../src/app/app.js')
}

main().catch(error => {
  console.error('[anubis] Failed to start:', error.message)
  process.exitCode = 1
})
