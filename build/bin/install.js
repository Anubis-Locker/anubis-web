import { existsSync, cpSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

if (existsSync(resolve('src/client/entry-web'))) {
  const renderer = resolve('node_modules/@ai-security-tool/electerm-react/client')
  if (!existsSync(renderer)) {
    throw new Error('Source builds require dev dependencies; run npm install before building')
  }
  const destination = resolve('src/client/electerm-react')
  rmSync(destination, { recursive: true, force: true })
  cpSync(renderer, destination, { recursive: true })
  console.log('Installed shared renderer sources')
}
