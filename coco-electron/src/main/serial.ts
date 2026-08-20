// One turn at a time on the engine.
//
// The Rust engine owns its state on a single thread (§43.3): a poll, a start
// and a cancel are processed one after another, never interleaved. Here the
// engine lives in an event loop instead, and every operation awaits a script
// — so without this, a poll that started before a cancel can finish after it
// and write the pre-cancel status back over `CANCELLING`. The refresh flag
// does not help: it only stops two refreshes overlapping.
//
// Queued, not dropped: a user's cancel waits its turn rather than being lost.

export type Turn = <T>(work: () => Promise<T>) => Promise<T>

export function serialize(): Turn {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    // `then(work, work)` so a failed turn does not cancel the queue: the next
    // one runs either way, and each caller still sees its own outcome.
    const turn = tail.then(work, work)
    tail = turn.then(
      () => undefined,
      () => undefined
    )
    return turn
  }
}
