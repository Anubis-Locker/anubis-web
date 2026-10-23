import os from 'os'
import { resolve } from 'path'
import { fileURLToPath } from 'node:url'
import getJson from './get-json.js'
import { resolveBrandResDir } from './brand-res.js'

export const cwd = process.cwd()
export const appRoot = fileURLToPath(new URL('../../../', import.meta.url))

const platform = os.platform()
const arch = os.arch()
const { NODE_ENV, NODE_TEST } = process.env
export const home = os.homedir()
export const sshKeysPath = resolve(
  home,
  '.ssh'
)
export const isWin = platform === 'win32'
export const isMac = platform === 'darwin'
export const isLinux = platform === 'linux'
export const isArm = arch.includes('arm')
export const isDev = NODE_ENV === 'development'
export const iconPath = resolve(
  appRoot,
  isDev
    ? resolve(resolveBrandResDir(appRoot), 'res/imgs/electerm-round-128x128.png')
    : 'dist/assets/images/electerm-round-128x128.png'
)
export const extIconPath = isDev
  ? '/node_modules/@ai-security-tool/icons/icons/'
  : '/icons/'
export const defaultUserName = 'default_user'
export const minWindowWidth = 320
export const minWindowHeight = 400
export const defaultLang = 'en_us'
export const tempDir = os.tmpdir()
export const homeOrTmp = os.homedir() || os.tmpdir()
export const packInfo = getJson(
  resolve(appRoot, 'package.json')
)
export const assetVersion = packInfo.devDependencies['@ai-security-tool/electerm-react']
export const isTest = !!NODE_TEST
