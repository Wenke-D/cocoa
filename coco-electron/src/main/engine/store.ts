// The private store (convention §5).
//
// It holds the one thing that belongs to coco rather than to any folder:
// which folders are registered, and as what. A folder cannot say that about
// itself — and remembering the kind is what lets a folder whose manifest
// breaks stay on the side it was on, carrying the error.
//
// It no longer holds a run-id counter. An id is derived from the experiment's
// own runs instead (`Runs.next_id` in memory.ts), which is the only source that
// cannot disagree with what is on disk — a counter can, and did: a folder
// carried over from another machine arrived with runs the counter knew
// nothing about, and the next start overwrote one of them.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError } from './errors'

export interface StoreData {
  jobs: string[]
  benches: string[]
}

export function empty_store(): StoreData {
  return { jobs: [], benches: [] }
}

export function load_store(store_path: string): StoreData {
  let text: string
  try {
    text = fs.readFileSync(store_path, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return empty_store()
    }
    throw EngineError.io(store_path, cause)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw EngineError.store(store_path, `store.json does not parse: ${(cause as Error).message}`)
  }
  const data = parsed as Partial<StoreData>
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    benches: Array.isArray(data.benches) ? data.benches : []
  }
}

export function save_store(store_path: string, store: StoreData): void {
  write_atomic(store_path, JSON.stringify(store, null, 2))
}

/** Writes a file atomically: temp file, fsync, then rename (convention §12). */
export function write_atomic(file_path: string, contents: string): void {
  const parent = path.dirname(file_path)
  try {
    fs.mkdirSync(parent, { recursive: true })
    const tmp = path.join(parent, `.${path.basename(file_path)}.tmp.${process.pid}`)
    fs.writeFileSync(tmp, contents)
    const fd = fs.openSync(tmp, 'r')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fs.renameSync(tmp, file_path)
  } catch (cause) {
    throw EngineError.io(file_path, cause)
  }
}
