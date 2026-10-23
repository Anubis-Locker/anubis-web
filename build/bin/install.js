import { existsSync, cpSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

if (existsSync(resolve('src/client/entry-web'))) {
  const renderer = resolve('node_modules/@ai-security-tool/electerm-react/client')
  if (!existsSync(renderer)) {
    throw new Error('Source builds require dev dependencies; run npm install before building')
  }
  const shared = resolve('node_modules/@ai-security-tool/electerm-react/app/common')
  for (const name of ['parse-vv', 'vv-to-tab']) {
    const entry = resolve(renderer, 'common', `${name}.js`)
    if (existsSync(entry) && readFileSync(entry, 'utf8').includes(`../../app/common/${name}.mjs`) &&
        !existsSync(resolve(shared, `${name}.mjs`))) {
      throw new Error(`Published renderer is missing its required app/common/${name}.mjs`)
    }
  }
  const destination = resolve('src/client/electerm-react')
  rmSync(destination, { recursive: true, force: true })
  cpSync(renderer, destination, { recursive: true })
  const sharedDestination = resolve('src/client/app/common')
  rmSync(sharedDestination, { recursive: true, force: true })
  if (existsSync(shared)) {
    cpSync(shared, sharedDestination, { recursive: true })
  }
  console.log('Installed shared renderer sources')
}
