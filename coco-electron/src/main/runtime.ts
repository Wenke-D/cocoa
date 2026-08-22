// The two things the whole main process shares, in one place so that nobody
// has to import `index.ts` to reach them — which is what would make the
// dependency graph a cycle.
//
// Everything else in `main/` owns its own state and exports functions over it;
// these two are genuinely process-wide singletons.

import { launch } from './launch'
import { Coco } from './engine/coco'
import { NoticeGate } from './notices'
import { resolve_store_path } from './store_path'

/**
 * The engine. Constructed here, at import: `store.json` is read exactly once.
 *
 * Before `ready`, which is fine — `launch.user_data` is settled at import,
 * override included, so the store goes where this launch's profile is. Where
 * the store lives is this side's decision, not the engine's: the engine takes
 * a path and knows nothing about the machine it is on.
 *
 * Operations call the engine directly — there is no queue. Synchronous work
 * is atomic on the event loop, and every write that follows an `await` guards
 * itself against the world having moved (`poll_job`'s history check,
 * `cancel_run`'s recheck, `start_job`'s reservation).
 */
export const engine = new Coco(resolve_store_path(launch.user_data))

/** What the user hears about a refresh, and how often; see `notices.ts`. */
export const notices = new NoticeGate()
