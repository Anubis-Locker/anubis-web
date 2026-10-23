import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = manifest.devDependencies['@ai-security-tool/electerm-react']
const assets = resolve(root, 'dist', 'assets')
for (const filename of [
  resolve(assets, 'js', `basic-${version}.js`),
  resolve(assets, 'css', `style-${version}.css`),
  resolve(assets, 'images'),
  resolve(assets, 'icons')
]) {
  await access(filename)
}
const destination = resolve(root, 'dist', 'browser-assets-package')
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
await cp(assets, resolve(destination, 'assets'), { recursive: true })
await cp(resolve(root, 'LICENSE'), resolve(destination, 'LICENSE'))
await writeFile(resolve(destination, 'package.json'), JSON.stringify({
  name: '@ai-security-tool/anubis-browser-assets',
  version,
  description: 'Shared Anubis browser renderer assets for desktop and Web',
  main: 'package.json',
  license: 'MIT',
  files: ['assets', 'LICENSE'],
  repository: {
    type: 'git',
    url: 'git+https://github.com/Anubis-Locker/anubis-web.git'
  }
}, null, 2) + '\n')
console.log(destination)
