import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { stageStandalone } from '../../build/bin/standalone.js'
import { writeProductionManifest } from '../../src/app/lib/production-assets.js'

const version = '5.7.2'
const renderer = '@ai-security-tool/electerm-react'
const sourceCommit = 'a'.repeat(40)
const integrity = 'sha512-' + Buffer.alloc(64, 1).toString('base64')

async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'anubis-standalone-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = async (name, content) => {
    const target = join(root, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  const browser = join(root, 'browser-package')
  await file('package.json', JSON.stringify({
    name: 'anubis-web',
    version: '5.6.12',
    devDependencies: { [renderer]: version },
    files: ['src/app', 'npm', '.sample.env', 'dist/assets', 'dist/views', 'dist/asset-manifest.json']
  }))
  await file('package-lock.json', JSON.stringify({
    lockfileVersion: 2,
    packages: {
      [`node_modules/${renderer}`]: {
        version,
        integrity,
        dev: true,
        resolved: `https://npm.anubis.locker/@ai-security-tool/electerm-react/-/electerm-react-${version}.tgz`
      },
      'node_modules/public-dependency': {
        version: '1.0.0',
        integrity,
        resolved: 'https://registry.npmmirror.com/public-dependency/-/public-dependency-1.0.0.tgz'
      }
    },
    dependencies: {
      'public-dependency': {
        version: '1.0.0',
        integrity,
        resolved: 'https://registry.npmjs.org/public-dependency/-/public-dependency-1.0.0.tgz'
      }
    }
  }))
  await file('src/app/views/index.pug', 'p ready')
  await file('npm/anubis-web.js', 'fixture CLI')
  await file('.sample.env', 'ENABLE_AUTH=1')
  await file('.env', 'must never ship')
  await file('data/private-record', 'must remain untouched')
  await file('browser-package/package.json', JSON.stringify({
    name: '@ai-security-tool/anubis-browser-assets', version
  }))
  for (const name of [
    `js/basic-${version}.js`, `js/electerm-${version}.js`, `js/worker-${version}.js`,
    `css/style-${version}.css`, 'images/electerm.png', 'images/electerm-watermark.png',
    'icons/terminal.svg', 'assets/font.woff2', 'assets/protocol.wasm', 'chunk/lazy.js'
  ]) await file(join('browser-package/dist/assets', name), name)
  await writeProductionManifest({ root: browser, version })
  const manifest = JSON.parse(await readFile(join(browser, 'dist/asset-manifest.json'), 'utf8'))
  manifest.renderer.integrity = integrity
  manifest.renderer.sourceCommit = 'b'.repeat(40)
  await file('browser-package/source.json', JSON.stringify(manifest))
  const { cp } = await import('node:fs/promises')
  await cp(join(browser, 'dist/assets'), join(browser, 'assets'), { recursive: true })
  return { root, browser, file }
}

test('standalone candidates are private, complete, own-registry locked and preserve original data/assets', async t => {
  const { root, browser } = await fixture(t)
  const original = await readFile(join(browser, 'source.json'), 'utf8')
  const { destination, release } = await stageStandalone({ root, assetsPackage: browser, sourceCommit })
  const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
  assert.equal(manifest.private, true)
  assert.equal(manifest.version, '5.6.12')
  assert.ok(manifest.files.includes('npm-shrinkwrap.json'))
  assert.equal(release.candidate, true)
  assert.equal(release.publishable, false)
  assert.equal(release.webSourceCommit, sourceCommit)
  assert.equal(release.renderer.version, version)
  const lock = JSON.parse(await readFile(join(destination, 'npm-shrinkwrap.json'), 'utf8'))
  for (const dependency of [lock.packages['node_modules/public-dependency'], lock.dependencies['public-dependency']]) {
    assert.equal(dependency.resolved, 'https://npm.anubis.locker/public-dependency/-/public-dependency-1.0.0.tgz')
    assert.equal(dependency.integrity, integrity)
  }
  await assert.rejects(access(join(destination, '.env')), { code: 'ENOENT' })
  await assert.rejects(access(join(destination, 'data')), { code: 'ENOENT' })
  await assert.rejects(access(join(destination, 'node_modules')), { code: 'ENOENT' })
  assert.equal(await readFile(join(browser, 'source.json'), 'utf8'), original)
  assert.equal(await readFile(join(root, 'data/private-record'), 'utf8'), 'must remain untouched')
  const second = await stageStandalone({ root, assetsPackage: browser, sourceCommit })
  assert.notEqual(second.destination, destination)
})

test('standalone staging rejects incorrect renderer provenance and broken lazy assets', async t => {
  const { root, browser, file } = await fixture(t)
  const manifest = JSON.parse(await readFile(join(browser, 'source.json'), 'utf8'))
  manifest.renderer.integrity = 'incorrect'
  await file('browser-package/source.json', JSON.stringify(manifest))
  await assert.rejects(stageStandalone({ root, assetsPackage: browser, sourceCommit }), /exact pinned/)
  manifest.renderer.integrity = integrity
  await file('browser-package/source.json', JSON.stringify(manifest))
  await rm(join(browser, 'assets/chunk/lazy.js'))
  await assert.rejects(stageStandalone({ root, assetsPackage: browser, sourceCommit }), /payload is not ready/)
})
