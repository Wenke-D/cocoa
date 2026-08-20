// The three things the whole main process shares, in one place so that nobody
// has to import `index.ts` to reach them — which is what would make the
// dependency graph a cycle.
//
// Everything else in `main/` owns its own state and exports functions over it;
// these three are genuinely process-wide singletons.

import { app } from 'electron'
import { Coco } from './engine/coco'
import { NoticeGate } from './notices'
import { serialize } from './serial'
import { resolve_store_path } from './store_path'

/**
 * The engine. Constructed here, at import: `store.json` is read exactly once.
 *
 * Before `ready`, which is fine — `app.getPath('userData')` answers from the
 * moment `package.json` is loaded, and answers the same thing it will answer
 * later. Where the store lives is this side's decision, not the engine's: the
 * engine takes a path and knows nothing about the machine it is on.
 */
export const engine = new Coco(resolve_store_path(app.getPath('userData')))

/** Every engine operation takes its turn; see `serial.ts` for why. */
export const on_engine = serialize()

/** What the user hears about a refresh, and how often; see `notices.ts`. */
export const notices = new NoticeGate()
