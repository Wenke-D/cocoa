// The private store (convention §5). Port of engine/store.rs.
// Same file, same field names, so the Rust and TS engines are interchangeable
// over one store — though they must not run at the same time.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError } from './errors'

export interface StoreData {
  entities: string[]
  last_args: Record<string, Record<string, string>>
  next_run_id: number
}

export function emptyStore(): StoreData {
  return { entities: [], last_args: {}, next_run_id: 0 }
}

export function loadStore(storePath: string): StoreData {
  let text: string
  try {
    text = fs.readFileSync(storePath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
    throw EngineError.io(storePath, cause)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw EngineError.store(storePath, `store.json does not parse: ${(cause as Error).message}`)
  }
  const data = parsed as Partial<StoreData>
  return {
    entities: Array.isArray(data.entities) ? data.entities : [],
    last_args: data.last_args ?? {},
    next_run_id: typeof data.next_run_id === 'number' ? data.next_run_id : 0
  }
}

export function saveStore(storePath: string, store: StoreData): void {
  writeAtomic(storePath, JSON.stringify(store, null, 2))
}

/** Allocates the next run id and persists immediately (§5). */
export function allocateRunId(storePath: string, store: StoreData): number {
  const id = store.next_run_id
  store.next_run_id += 1
  saveStore(storePath, store)
  return id
}

/** Writes a file atomically: temp file, fsync, then rename (convention §12). */
export function writeAtomic(filePath: string, contents: string): void {
  const parent = path.dirname(filePath)
  try {
    fs.mkdirSync(parent, { recursive: true })
    const tmp = path.join(parent, `.${path.basename(filePath)}.tmp.${process.pid}`)
    fs.writeFileSync(tmp, contents)
    const fd = fs.openSync(tmp, 'r')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fs.renameSync(tmp, filePath)
  } catch (cause) {
    throw EngineError.io(filePath, cause)
  }
}
