// What the renderer is told, and when.
//
// The backend keeps its own model of the world, rebuilt from disk every cycle
// — the filesystem is a shared truth (humans edit manifests, scripts write
// reports), so knowing "what changed" means comparing against what it said
// last time. That comparison happens in `diffWorlds`, entry by entry; the
// renderer only ever hears its conclusions, as events.

import type { CocoEvent, World } from '@shared/world'
import { engine, notices } from './runtime'
import { nowStamp } from './engine/record'
import { buildWorld } from './engine/world'
import { diffWorlds } from './sync'
import type { Maybe } from './types'
import { send } from './window'

let model: Maybe<World> = null
let lastRefresh: Maybe<string> = null

/**
 * Whether the page has asked for its starting state yet. Events sent before
 * that are harmless — the bootstrap supersedes them — but a *notice* is not
 * in the bootstrap, so one said during startup would simply be lost. The
 * agent interface failing to bind is exactly that case.
 */
let bootstrapped = false
const pendingNotices: CocoEvent[] = []

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function announce(notice: Maybe<CocoEvent>): CocoEvent[] {
  return notice === null ? [] : [notice]
}

/** Says something that must survive the window not being ready to hear it. */
export function announceWhenHeard(events: CocoEvent[]): void {
  if (events.length === 0) return
  if (!bootstrapped) {
    pendingNotices.push(...events)
    return
  }
  send(events)
}

/**
 * The world as the window renders it, built on demand. Answers the bootstrap
 * and the agent's reads, neither of which may wait on the engine.
 */
export function currentModel(): World {
  return (model ??= buildWorld(engine, lastRefresh))
}

/**
 * The page has its starting state. Anything held back during startup goes out
 * just after the answer, so the page has its world before it is told anything
 * about it.
 */
export function markBootstrapped(): void {
  bootstrapped = true
  if (pendingNotices.length > 0) {
    const waiting = pendingNotices.splice(0)
    setImmediate(() => send(waiting))
  }
}

/**
 * One publish cycle: rebuild the model from disk, turn the difference into
 * events, send them as one batch. The `refreshed` heartbeat rides along when
 * a refresh pass completed, so an idle engine sends heartbeats and nothing
 * else.
 */
export function publishCycle(refreshedAt: Maybe<string>, extra: CocoEvent[] = []): void {
  let next: World
  try {
    next = buildWorld(engine, refreshedAt ?? lastRefresh)
  } catch (error) {
    console.error('world build failed:', error)
    // Nothing can be said about the world, but something must still be said
    // about the failure: a build that throws leaves the page showing a world
    // that has quietly stopped being updated.
    send([...extra, ...announce(notices.automatic(messageOf(error)))])
    return
  }
  const events: CocoEvent[] = model === null ? [] : diffWorlds(model, next)
  model = next
  if (refreshedAt !== null) {
    events.push({ kind: 'refreshed', at: refreshedAt })
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
export function publishRefreshed(extra: CocoEvent[] = []): void {
  lastRefresh = nowStamp()
  publishCycle(lastRefresh, extra)
}
