// Type vocabulary for the main process. Types only — nothing here has a
// runtime, and nothing here imports anything.
//
// Deliberately not in `@shared`: the shared types mirror the on-disk and
// on-the-wire shapes byte for byte (`world.ts` is the serde mirror), and there
// `string | null` spelled out is the point — a reader must be able to see that
// the JSON carries a literal `null` without following an alias.
//
// Deliberately not used in `engine/` either: that directory imports nothing
// from outside itself, which is what makes it testable with no app around it
// and portable between implementations. A cosmetic alias is not worth being
// the first thing to cross that line.

/**
 * A value that may not be there — `null`, never `undefined`.
 *
 * `null` because that is what crosses IPC and lands in JSON; `undefined`
 * properties vanish from `JSON.stringify` output, and the records have to stay
 * byte-compatible with the egui engine.
 *
 * Note this is a bare union, not a container: there is no `.map()` on it. It
 * marks *control flow* — a slot not filled yet, a lookup with no answer — and
 * not data shape. A field describing what a value IS keeps `| null` written
 * out.
 */
export type Maybe<T> = T | null
