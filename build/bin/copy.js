import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveBrandResDir } from '../../src/app/common/brand-res.js'

const root = process.cwd()
await mkdir(resolve(root, 'dist/assets'), { recursive: true })
for (const [from, to] of [
  [resolve(root, 'src/client/statics'), resolve(root, 'dist/assets')],
  [resolve(resolveBrandResDir(root), 'res/imgs'), resolve(root, 'dist/assets/images')],
  [resolve(root, 'src/app/views'), resolve(root, 'dist/views')],
  [resolve(root, 'node_modules/@ai-security-tool/icons/icons'), resolve(root, 'dist/assets/icons')]
]) {
  await cp(from, to, { recursive: true })
}
