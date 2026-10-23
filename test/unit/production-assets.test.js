import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { verifyProductionAssets, writeProductionManifest } from '../../src/app/lib/production-assets.js'

const version = '5.7.2'
const run = promisify(execFile)
const buildScript = fileURLToPath(new URL('../../build/bin/build.js', import.meta.url))
const copyScript = fileURLToPath(new URL('../../build/bin/copy.js', import.meta.url))

async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'anubis-production-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = async (name, content) => {
    const target = join(root, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  await file('dist/views/index.pug', 'doctype html\nhtml\n  body ready')
  for (const name of [
    `js/basic-${version}.js`, `js/electerm-${version}.js`, `js/worker-${version}.js`,
    `css/style-${version}.css`, 'images/electerm.png', 'images/electerm-watermark.png',
    'icons/terminal.svg', 'assets/font.woff2', 'assets/protocol.wasm', 'chunk/lazy.js'
  ]) await file(join('dist/assets', name), name)
  await writeProductionManifest({ root, version })
  return { root, file }
}

test('complete standalone payload verifies without changing existing files', async t => {
  const { root } = await fixture(t)
  const before = await readFile(join(root, 'dist/asset-manifest.json'), 'utf8')
  await verifyProductionAssets({ root, version })
  assert.equal(await readFile(join(root, 'dist/asset-manifest.json'), 'utf8'), before)
})

test('missing and invalid production views fail before serving a request', async t => {
  const { root, file } = await fixture(t)
  await rm(join(root, 'dist/views/index.pug'))
  await assert.rejects(verifyProductionAssets({ root, version }), /payload is not ready.*index.pug/)
  await file('dist/views/index.pug', 'html\n   body\n  invalid indentation')
  await assert.rejects(verifyProductionAssets({ root, version }), /payload is not ready/)
  await file('custom-views/index.pug', 'p custom view')
  await verifyProductionAssets({ root, version, views: join(root, 'custom-views') })
})

test('worker, fonts, WASM, lazy chunks and asset corruption are all checked', async t => {
  const { root, file } = await fixture(t)
  for (const name of ['js/worker-5.7.2.js', 'assets/font.woff2', 'assets/protocol.wasm', 'chunk/lazy.js']) {
    await rm(join(root, 'dist/assets', name))
    await assert.rejects(verifyProductionAssets({ root, version }), /payload is not ready/)
    await file(join('dist/assets', name), name)
  }
  await file('dist/assets/chunk/lazy.js', 'corrupted chunk')
  await assert.rejects(verifyProductionAssets({ root, version }), /integrity mismatch: chunk\/lazy.js/)
})

test('missing or stale manifests cannot bless a mismatched renderer', async t => {
  const { root } = await fixture(t)
  await assert.rejects(verifyProductionAssets({ root, version: '5.7.3' }), /does not match renderer 5.7.3/)
  await rm(join(root, 'dist/asset-manifest.json'))
  await assert.rejects(verifyProductionAssets({ root, version }), /payload is not ready.*asset-manifest.json/)
})

test('compiler failures propagate and never run the copy step or report success', async t => {
  const { root, file } = await fixture(t)
  await file('node_modules/vite/bin/vite.js', 'process.exit(17)')
  await file('build/bin/copy.js', "require('node:fs').writeFileSync('copy-ran', 'unexpected')")
  await assert.rejects(run(process.execPath, [buildScript], { cwd: root }), error => {
    assert.equal(error.code, 1)
    assert.doesNotMatch(error.stdout, /done build/)
    return true
  })

  await assert.rejects(readFile(join(root, 'copy-ran')), { code: 'ENOENT' })
})

test('missing copy inputs fail instead of silently producing a partial deployment', async t => {
  const { root } = await fixture(t)
  const before = await readFile(join(root, 'dist/asset-manifest.json'), 'utf8')
  await assert.rejects(run(process.execPath, [copyScript], { cwd: root }), /ENOENT/)
  assert.equal(await readFile(join(root, 'dist/asset-manifest.json'), 'utf8'), before)
})
