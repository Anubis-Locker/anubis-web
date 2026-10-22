import { resolve } from 'path'
import pkg from 'shelljs'
import { cwd } from './build-common.js'
import { resolveBrandResDir } from '../../src/app/common/brand-res.js'

const { cp, mkdir } = pkg

const f1 = resolve(
  cwd,
  'src/client/statics/*'
)
const from0 = resolve(
  cwd,
  'node_modules/@ai-security-tool/icons/icons'
)
const from1 = resolve(
  cwd,
  'src/app/views'
)

const t1 = resolve(
  cwd,
  'dist/assets/'
)
const to1 = resolve(
  cwd,
  'dist'
)
const to2 = resolve(
  cwd,
  'dist/assets/icons'
)
const brandRes = resolveBrandResDir(cwd)
const arr = [
  {
    from: resolve(brandRes, 'res/imgs').split('\\').join('/') + '/*',
    to: resolve(cwd, 'dist/assets/images'),
    mkdir: true
  },
  {
    from: f1,
    to: t1
  },
  {
    from: from1,
    to: to1
  },
  {
    from: from0,
    to: to2
  }
]

for (const obj of arr) {
  const {
    file, from, to, mkdir: needMkdir
  } = obj
  if (needMkdir) {
    mkdir('-p', to)
  }
  if (file) {
    cp(from, to)
  } else {
    cp('-r', from, to)
  }
}
