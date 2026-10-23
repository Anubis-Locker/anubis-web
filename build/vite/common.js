import { config as conf } from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { resolveBrandResDir } from '../../src/app/common/brand-res.js'

conf()

export const cwd = process.cwd()
export const env = process.env
export const isProd = env.NODE_ENV === 'production'
export const isMac = env.PLATFORM === 'darwin'
export const isWin = env.PLATFORM === 'win32'
const packPath = resolve(cwd, 'package.json')
export const pack = JSON.parse(readFileSync(packPath).toString())
export const version = pack.devDependencies['@ai-security-tool/electerm-react']
export const viewPath = resolve(cwd, 'src/app/views')
// brand resource package: BRAND_RES_DIR | ../resource | node_modules/@ai-security-tool/resource
export const resourceDir = resolveBrandResDir(cwd)
export const staticPaths = [
  {
    dir: resolve(cwd, 'node_modules/@ai-security-tool/icons/icons'),
    path: '/icons'
  },
  {
    dir: resolve(resourceDir, 'tray-icons'),
    path: '/images'
  },
  {
    dir: resolve(resourceDir, 'res/imgs'),
    path: '/images'
  },
  {
    dir: resolve(cwd, 'src/client/statics'),
    path: '/'
  }
]
