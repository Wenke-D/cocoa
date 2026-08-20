// The private store (§5). Ported from engine/store.rs's inline tests.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadStore, saveStore, writeAtomic } from '../src/main/engine/store'
import { cleanupTempDirs, tempDir } from './support'

afterEach(cleanupTempDirs)

describe('store', () => {
  it('reads a missing store as the empty one and round-trips it', () => {
    const file = path.join(tempDir(), 'store.json')
    const store = loadStore(file)
    expect(store).toEqual({ entities: [] })
    saveStore(file, store)
    expect(loadStore(file)).toEqual(store)
  })

  it('refuses a store that does not parse', () => {
    const file = path.join(tempDir(), 'store.json')
    fs.writeFileSync(file, '{ not json')
    expect(() => loadStore(file)).toThrow('does not parse')
  })

  it('writes atomically, creating parents and leaving no temp file behind', () => {
    const dir = tempDir()
    const file = path.join(dir, 'nested', 'deeper', 'run.json')
    writeAtomic(file, 'first')
    expect(fs.readFileSync(file, 'utf8')).toBe('first')
    writeAtomic(file, 'second')
    expect(fs.readFileSync(file, 'utf8')).toBe('second')
    expect(fs.readdirSync(path.dirname(file))).toEqual(['run.json'])
  })
})
