// The private store (§5).

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { load_store, save_store, write_atomic } from '../src/main/engine/store'
import { cleanup_temp_dirs, temp_dir } from './support'

afterEach(cleanup_temp_dirs)

describe('store', () => {
  it('reads a missing store as the empty one and round-trips it', () => {
    const file = path.join(temp_dir(), 'store.json')
    const store = load_store(file)
    expect(store).toEqual({ jobs: [], campaigns: [] })
    save_store(file, store)
    expect(load_store(file)).toEqual(store)
  })

  it('refuses a store that does not parse', () => {
    const file = path.join(temp_dir(), 'store.json')
    fs.writeFileSync(file, '{ not json')
    expect(() => load_store(file)).toThrow('does not parse')
  })

  it('writes atomically, creating parents and leaving no temp file behind', () => {
    const dir = temp_dir()
    const file = path.join(dir, 'nested', 'deeper', 'run.json')
    write_atomic(file, 'first')
    expect(fs.readFileSync(file, 'utf8')).toBe('first')
    write_atomic(file, 'second')
    expect(fs.readFileSync(file, 'utf8')).toBe('second')
    expect(fs.readdirSync(path.dirname(file))).toEqual(['run.json'])
  })
})
