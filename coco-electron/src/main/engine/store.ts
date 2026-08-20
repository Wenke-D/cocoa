// The private store (convention §5). Originally a port of engine/store.rs.
//
// It holds the one thing that belongs to coco rather than to any folder:
// which folders are registered. A folder cannot say that about itself.
//
// It no longer holds a run-id counter. An id is derived from the experiment's
// own runs instead (`nextRunId` in coco.ts), which is the only source that
// cannot disagree with what is on disk — a counter can, and did: a folder
// carried over from another machine arrived with runs the counter knew
// nothing about, and the next start overwrote one of them.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError } from './errors'

export interface StoreData {
  entities: string[]
}

export function emptyStore(): StoreData {
  return { entities: [] }
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
    entities: Array.isArray(data.entities) ? data.entities : []
  }
}

export function saveStore(storePath: string, store: StoreData): void {
  writeAtomic(storePath, JSON.stringify(store, null, 2))
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
