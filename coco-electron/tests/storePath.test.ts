// Where the store lives, and the one-time carry-over from where it used to.
// The migration is the only part of this with a way to lose something, so it
// is the part with tests.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveStorePath } from '../src/main/storePath'
import { cleanupTempDirs, tempDir } from './support'

afterEach(cleanupTempDirs)

const saved = process.env.COCO_STORE_PATH
beforeEach(() => {
  delete process.env.COCO_STORE_PATH
})
afterEach(() => {
  if (saved === undefined) delete process.env.COCO_STORE_PATH
  else process.env.COCO_STORE_PATH = saved
})

function legacyWith(entities: string[]): string {
  const file = path.join(tempDir(), 'legacy', 'store.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ entities }))
  return file
}

describe('resolveStorePath', () => {
  it('carries the old store over the first time, and leaves it behind', () => {
    const userData = tempDir()
    const legacy = legacyWith(['/exp/solver'])

    const resolved = resolveStorePath(userData, legacy)

    expect(resolved).toBe(path.join(userData, 'store.json'))
    expect(JSON.parse(fs.readFileSync(resolved, 'utf8'))).toEqual({ entities: ['/exp/solver'] })
    // Copied, not moved: coco-egui still reads the old one.
    expect(fs.existsSync(legacy)).toBe(true)
  })

  it('never overwrites a store that is already there', () => {
    const userData = tempDir()
    const legacy = legacyWith(['/exp/from-the-past'])
    const target = path.join(userData, 'store.json')
    fs.writeFileSync(target, JSON.stringify({ entities: ['/exp/current'] }))

    resolveStorePath(userData, legacy)

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ entities: ['/exp/current'] })
  })

  it('writes nothing when there is no old store', () => {
    const userData = tempDir()
    const resolved = resolveStorePath(userData, path.join(tempDir(), 'absent.json'))
    expect(resolved).toBe(path.join(userData, 'store.json'))
    expect(fs.existsSync(resolved)).toBe(false)
  })

  // A drive run points at a scratch store; it must not carry anything anywhere.
  it('takes COCO_STORE_PATH as final, and carries nothing over', () => {
    const userData = tempDir()
    const legacy = legacyWith(['/exp/solver'])
    process.env.COCO_STORE_PATH = '/tmp/scratch/store.json'

    expect(resolveStorePath(userData, legacy)).toBe('/tmp/scratch/store.json')
    expect(fs.existsSync(path.join(userData, 'store.json'))).toBe(false)
  })
})
