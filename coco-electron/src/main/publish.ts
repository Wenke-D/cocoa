// What the renderer is told, and when.
//
// The backend keeps its own model of the world, rebuilt from disk every cycle
// — the filesystem is a shared truth (humans edit manifests, scripts write
// reports), so knowing "what changed" means comparing against what it said
// last time. That comparison happens in `diff_worlds`, entry by entry; the
// renderer only ever hears its conclusions, as events.

import type { CocoEvent, World } from '@shared/world'
import { engine, notices } from './runtime'
import { now_stamp } from './engine/record'
import { build_world } from './engine/world'
import { diff_worlds } from './sync'
import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'
import { send } from './window'
import { log_for } from './log'

const log = log_for('publish')

let world: Maybe<World> = empty()
let last_refresh: Maybe<string> = empty()

export function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function announce(notice: Maybe<CocoEvent>): CocoEvent[] {
  return notice.is_empty() ? [] : [notice.value]
}

/**
 * The world as the window renders it, built on demand. Answers the bootstrap
 * and the agent's reads, neither of which may wait on the engine.
 */
export function current_world(): World {
  if (world.is_present()) {
    return world.value
  }
  const built = build_world(engine, last_refresh.or_null())
  world = some(built)
  return built
}

/**
 * One publish cycle: rebuild the model from disk, turn the difference into
 * events, send them as one batch. The `refreshed` heartbeat rides along when
 * a refresh pass completed, so an idle engine sends heartbeats and nothing
 * else.
 */
export function publish_cycle(refreshed_at: Maybe<string>, extra: CocoEvent[] = []): void {
  let next: World
  try {
    next = build_world(engine, refreshed_at.or(last_refresh.or_null()))
  } catch (error) {
    log.error('world build failed:', error)
    // Nothing can be said about the world, but something must still be said
    // about the failure: a build that throws leaves the page showing a world
    // that has quietly stopped being updated.
    send([...extra, ...announce(notices.automatic(some(message_of(error))))])
    return
  }
  const events: CocoEvent[] = world.is_empty() ? [] : diff_worlds(world.value, next)
  world = some(next)
  if (refreshed_at.is_present()) {
    events.push({ kind: 'refreshed', at: refreshed_at.value })
  }
  // The notice rides in the same batch as the changes it is about: one batch
  // per logical operation, so the page never shows the message before the
  // state it explains.
  events.push(...extra)
  send(events)
}

/**
 * A cycle that also stamps the refresh. `lastRefresh` never leaves this
 * module: it is the publisher's answer to "as of when", and every caller that
 * wanted it was only going to hand it straight back.
 */
export function publish_refreshed(extra: CocoEvent[] = []): void {
  last_refresh = some(now_stamp())
  publish_cycle(last_refresh, extra)
}
