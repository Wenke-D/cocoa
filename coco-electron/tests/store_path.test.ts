// Where the store lives, and the one-time carry-over from where it used to.
// The migration is the only part of this with a way to lose something, so it
// is the part with tests.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolve_store_path } from '../src/main/store_path'
import { cleanup_temp_dirs, temp_dir } from './support'

afterEach(cleanup_temp_dirs)

const saved = process.env.COCO_STORE_PATH
beforeEach(() => {
  delete process.env.COCO_STORE_PATH
})
afterEach(() => {
  if (saved === undefined) {
    delete process.env.COCO_STORE_PATH
  } else {
    process.env.COCO_STORE_PATH = saved
  }
})

function legacy_with(entities: string[]): string {
  const file = path.join(temp_dir(), 'legacy', 'store.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ entities }))
  return file
}

describe('resolve_store_path', () => {
  it('carries the old store over the first time, and leaves it behind', () => {
    const user_data = temp_dir()
    const legacy = legacy_with(['/exp/solver'])

    const resolved = resolve_store_path(user_data, legacy)

    expect(resolved).toBe(path.join(user_data, 'store.json'))
    expect(JSON.parse(fs.readFileSync(resolved, 'utf8'))).toEqual({ entities: ['/exp/solver'] })
    // Copied, not moved: the old one is left where it was.
    expect(fs.existsSync(legacy)).toBe(true)
  })

  it('never overwrites a store that is already there', () => {
    const user_data = temp_dir()
    const legacy = legacy_with(['/exp/from-the-past'])
    const target = path.join(user_data, 'store.json')
    fs.writeFileSync(target, JSON.stringify({ entities: ['/exp/current'] }))

    resolve_store_path(user_data, legacy)

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ entities: ['/exp/current'] })
  })

  it('writes nothing when there is no old store', () => {
    const user_data = temp_dir()
    const resolved = resolve_store_path(user_data, path.join(temp_dir(), 'absent.json'))
    expect(resolved).toBe(path.join(user_data, 'store.json'))
    expect(fs.existsSync(resolved)).toBe(false)
  })

  // A drive run points at a scratch store; it must not carry anything anywhere.
  it('takes COCO_STORE_PATH as final, and carries nothing over', () => {
    const user_data = temp_dir()
    const legacy = legacy_with(['/exp/solver'])
    process.env.COCO_STORE_PATH = '/tmp/scratch/store.json'

    expect(resolve_store_path(user_data, legacy)).toBe('/tmp/scratch/store.json')
    expect(fs.existsSync(path.join(user_data, 'store.json'))).toBe(false)
  })
})
