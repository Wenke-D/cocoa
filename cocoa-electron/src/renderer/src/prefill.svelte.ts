// The history's row menu (§22.6): a run's parameters, used again — and a
// campaign call's, by a run that takes the call's place (§18.3).

import type { Params } from '@shared/params'
import { check_value } from '@shared/params'
import type { ReplaceTarget, StartResult } from '@shared/protocol'
import { navigate } from './navigation'
import { notify } from './notice'
import { app } from './state.svelte'
import { entity_of } from './world_queries'

/**
 * Values for the Start page to open with, from a run in the history (§22.6).
 * Handed over once and consumed: the draft then lives in the page, as always.
 */
export interface Prefill {
  entity_id: string
  /** Only values that still fit the manifest: the rest were dropped, and said. */
  values: Params
  /** The campaign call the run will take the place of (convention §8.5), or `null`. */
  replaces: ReplaceTarget | null
}

/**
 * Starts a new run with exactly a past run's parameters. The backend validates
 * them against the manifest as it is now; a refusal — the manifest changed —
 * is put in a modal, because it has to be read, not one that fades. With
 * `replaces`, the run takes that campaign call's place.
 */
export async function start_again(
  entity_id: string,
  params: Params,
  replaces: ReplaceTarget | null = null
): Promise<void> {
  const entity = entity_of(entity_id)
  if (entity === undefined) {
    notify('That experiment is no longer in the Explorer.')
    return
  }
  let result: StartResult
  try {
    // The params come off a run in the world, a `$state` proxy: the bridge
    // clones what it is handed, and a proxy does not clone.
    result =
      replaces === null
        ? await window.cocoa.start_run(entity.name, $state.snapshot(params))
        : await window.cocoa.start_run(
            entity.name,
            $state.snapshot(params),
            $state.snapshot(replaces)
          )
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (result.ok) {
    notify(
      replaces === null
        ? `Run ${result.run_id} started.`
        : `Run ${result.run_id} started in place of run ${replaces.run_id}.`
    )
    return
  }
  app.overlay = { kind: 'refused', title: 'Could not start', message: result.message }
}

/**
 * Opens the Start page with a past run's parameters filled in, as far as the
 * manifest as it is now allows: a parameter it no longer declares is dropped,
 * one it newly declares is left empty, one whose value no longer fits its
 * shape — an enum value since removed, one string where a list now is — is
 * left empty too, and the notice says which. With `replaces`, the page starts
 * a run that takes that campaign call's place.
 */
export function prefill_start(
  entity_id: string,
  run_id: string,
  params: Params,
  replaces: ReplaceTarget | null = null
): void {
  const entity = entity_of(entity_id)
  if (entity === undefined) {
    notify('That experiment is no longer in the Explorer.')
    return
  }
  const values: Params = {}
  const missing: string[] = []
  const unfit: string[] = []
  for (const spec of entity.parameters) {
    if (!(spec.name in params)) {
      missing.push(spec.name)
    } else if (check_value(spec, params[spec.name]) !== null) {
      unfit.push(spec.name)
    } else {
      values[spec.name] = params[spec.name]
    }
  }
  const declared = entity.parameters.map((spec) => spec.name)
  const extra = Object.keys(params).filter((name) => !declared.includes(name))
  app.prefill = { entity_id, values, replaces }
  navigate({ page: 'start', entity_id })
  if (missing.length === 0 && extra.length === 0 && unfit.length === 0) {
    notify(`Parameters of run ${run_id} filled in.`)
    return
  }
  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(`${quoted(missing)} ${missing.length === 1 ? 'is' : 'are'} new and left empty`)
  }
  if (unfit.length > 0) {
    problems.push(
      `${quoted(unfit)} no longer ${unfit.length === 1 ? 'fits' : 'fit'} and ${unfit.length === 1 ? 'is' : 'are'} left empty`
    )
  }
  if (extra.length > 0) {
    problems.push(`${quoted(extra)} ${extra.length === 1 ? 'is' : 'are'} no longer taken`)
  }
  notify(`Filled what run ${run_id} had; ${problems.join('; ')}.`, 'error')
}

/** The Start page takes the prefill meant for it, once. */
export function take_prefill(entity_id: string): Prefill | null {
  const prefill = app.prefill
  if (prefill === null || prefill.entity_id !== entity_id) {
    return null
  }
  app.prefill = null
  return prefill
}

function quoted(names: string[]): string {
  return names.map((name) => `\`${name}\``).join(', ')
}
