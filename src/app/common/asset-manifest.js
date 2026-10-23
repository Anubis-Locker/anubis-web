import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export async function treeManifest (directory, prefix = '') {
  const result = {}
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const entry of entries) {
    const relative = prefix + entry.name
    const filename = join(directory, entry.name)
    if (entry.isDirectory()) {
      Object.assign(result, await treeManifest(filename, relative + '/'))
    } else if (entry.isFile()) {
      result[relative] = createHash('sha256').update(await readFile(filename)).digest('hex')
    } else {
      throw new Error(`Browser package inputs must be regular files: ${relative}`)
    }
  }
  return result
}

export function treeHash (files) {
  return createHash('sha256')
    .update(Object.entries(files).map(([name, hash]) => `${hash}  ${name}\n`).join(''))
    .digest('hex')
}
