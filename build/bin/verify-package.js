import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = manifest.devDependencies['@ai-security-tool/electerm-react']
for (const filename of [
  'npm/anubis-web.js',
  'src/app/app.js',
  'dist/views/index.pug',
  `dist/assets/js/basic-${version}.js`,
  `dist/assets/js/electerm-${version}.js`,
  `dist/assets/css/style-${version}.css`,
  'dist/assets/images/electerm.png',
  'dist/assets/icons'
]) {
  await access(resolve(root, filename))
}
console.log(`Ready to pack ${manifest.name}@${manifest.version}; renderer ${version}`)
