/**
 * Resolve the brand resource package (logos / icons) folder.
 *
 * Order (first existing wins):
 *  1. env BRAND_RES_DIR (absolute, or relative to the repo root)
 *  2. ../resource relative to the repo root (monorepo layout)
 *  3. node_modules/@ai-security-tool/resource
 * Keep in sync with app/src/common/brand-res.js.
 */

import { resolve, join } from 'path'
import { existsSync } from 'fs'

export function resolveBrandResDir (root, env = process.env) {
  const candidates = []
  if (env.BRAND_RES_DIR) {
    candidates.push(resolve(root, env.BRAND_RES_DIR))
  }
  candidates.push(
    resolve(root, '../resource'),
    join(root, 'node_modules', '@ai-security-tool', 'resource')
  )
  const found = candidates.find(d => existsSync(join(d, 'res', 'imgs')))
  return found || candidates[0]
}
