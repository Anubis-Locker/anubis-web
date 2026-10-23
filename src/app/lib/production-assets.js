import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pug from 'pug'
import { treeManifest, treeHash } from '../common/asset-manifest.js'

function checkAssets (files, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Production renderer must have an exact version')
  for (const name of [
    `js/basic-${version}.js`, `js/electerm-${version}.js`, `js/worker-${version}.js`,
    `css/style-${version}.css`, 'images/electerm.png', 'images/electerm-watermark.png'
  ]) {
    if (!files[name]) throw new Error(`Missing production asset: ${name}`)
  }
  for (const pattern of [/\.(woff2?|ttf|otf)$/, /\.wasm$/, /^icons\/.+\.svg$/]) {
    if (!Object.keys(files).some(name => pattern.test(name))) {
      throw new Error(`Missing production assets matching ${pattern}`)
    }
  }
}

export async function writeProductionManifest ({ root, version }) {
  const files = await treeManifest(resolve(root, 'dist/assets'))
  checkAssets(files, version)
  const manifest = {
    renderer: { name: '@ai-security-tool/electerm-react', version },
    assets: { count: Object.keys(files).length, treeSha256: treeHash(files), files }
  }
  await writeFile(resolve(root, 'dist/asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

export async function verifyProductionAssets ({ root, version, views = resolve(root, 'dist/views') }) {
  try {
    pug.compileFile(resolve(views, 'index.pug'))
    const manifest = JSON.parse(await readFile(resolve(root, 'dist/asset-manifest.json'), 'utf8'))
    if (manifest.renderer?.name !== '@ai-security-tool/electerm-react' || manifest.renderer.version !== version) {
      throw new Error(`Production asset manifest does not match renderer ${version}`)
    }
    const files = await treeManifest(resolve(root, 'dist/assets'))
    checkAssets(files, version)
    if (!manifest.assets?.files || manifest.assets.count !== Object.keys(files).length) {
      throw new Error('Production asset manifest has an incomplete file list')
    }
    for (const name of new Set([...Object.keys(files), ...Object.keys(manifest.assets.files)])) {
      if (files[name] !== manifest.assets.files[name]) throw new Error(`Production asset integrity mismatch: ${name}`)
    }
    if (treeHash(files) !== manifest.assets.treeSha256) throw new Error('Production asset tree checksum mismatch')
  } catch (cause) {
    throw new Error(
      `Production Web payload is not ready for renderer ${version}: ${cause.message}. ` +
      'Build a complete payload with npm run build, or reinstall a verified standalone candidate. Preserve existing settings and data.',
      { cause }
    )
  }
}
