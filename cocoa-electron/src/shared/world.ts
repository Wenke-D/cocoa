// The view model the main process sends the renderer. Enums are externally
// tagged: a unit variant is a bare string, a struct variant is
// `{ VariantName: { ...fields } }`.

import type { ParamSpec, Params } from './params'

export type EntityKind = 'Job' | 'Campaign'

export type ManifestState = 'Valid' | 'Missing' | { Invalid: { message: string } }

export type RunStatus =
  | 'Deploying'
  | 'Starting'
  | 'Pending'
  | 'Running'
  | 'Completed'
  | 'Analyzing'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelling'
  | 'Cancelled'
  | 'Error'

export type QueryHealth = 'Healthy' | 'Delayed' | { Unavailable: { message: string } }

export type Trigger = 'Human' | 'Agent'

export type RunOrigin =
  | 'Human'
  | 'Agent'
  | {
      Campaign: {
        name: string
        campaign_id: string | null
        campaign_run_id: string
        call: number
      }
    }

export type ReportFormat = 'PlainText' | 'Html'

/** One report file of a run: `report/<run>.txt` or `report/<run>.html`. */
export interface ReportFile {
  format: ReportFormat
  text_bytes: number
}

export type ReportState =
  | 'Unavailable'
  | 'Generating'
  | 'Missing'
  /** Every report file the run wrote, one or both, plain text first. */
  | { Available: { files: ReportFile[] } }
  | { ReadError: { message: string } }

/** A registered job or campaign, as the Explorer lists it. */
export interface Entity {
  /** The canonical folder path. */
  id: string
  kind: EntityKind
  name: string
  /** The manifest's `description`, or `null` when it gives none. */
  description: string | null
  /** The folder path as shown, with the home directory abbreviated. */
  path: string
  manifest: ManifestState
  /** What a start must supply, in the order the form shows them (§17.3). */
  parameters: ParamSpec[]
}

/** One run in a job's history. */
export interface JobRun {
  /** The run id, unique only within its job. */
  id: string
  job_id: string
  origin: RunOrigin
  started_at: string
  /** When the run reached a terminal status, or `null` while it has not. */
  ended_at: string | null
  /** Render and launch params together, written out as `--name value`. */
  parameters: string
  /** The same, as given: what a new run from this one would be started with. */
  params: Params
  status: RunStatus
  query_health: QueryHealth
  /** Stamped on every rebuild, so it is left out of the run's identity. */
  last_successful_query: string
  report: ReportState
  /** Why the report script failed on a `Failed` run, which keeps its status
   * whatever the report does (convention §7.3.1). Elsewhere a failed report
   * is the run's `Error`, and this is `null`. */
  report_error: string | null
  /** Whether the report can be re-run by hand now: the engine would take the
   * run (convention §7.3.2), and its report is not already `Generating`. */
  report_rerunnable: boolean
  /** How many entries the report attached in its attachment directory
   * (convention §7.3); 0 when it attached nothing, and while it runs. */
  attachments: number
  /** Whether the job's `[visualize]` script can be opened on this run now: it
   * has one, and the run has a report that is not `Generating` (§7.7). */
  visualizable: boolean
  /** How the job was made ready before this run launched (convention §7.5,
   * §7.6); `null` for a run recorded before deploys existed. */
  deploy: RunDeploy | null
  /** Why the run is `Error`. */
  error: string | null
}

/** A run's record of its start's check, and the deploy a `STALE` one ran. */
export interface RunDeploy {
  check: 'CURRENT' | 'STALE'
  reason: string | null
  /** When the deploy finished; `null` while it runs, and for `CURRENT`. */
  at: string | null
  /** The deploy script's output, when it failed. */
  error: string | null
}

export interface CampaignPlanStep {
  index: number
  job_id: string
  parameters: string
  run_id: string
}

export interface CampaignRun {
  id: string
  campaign_id: string
  by: Trigger
  started_at: string
  ended_at: string | null
  parameters: string
  params: Params
  plan: { steps: CampaignPlanStep[] }
  status: RunStatus
  query_health: QueryHealth
  last_successful_query: string
  report: ReportState
  /** How many entries the campaign's report attached (convention §8.3). */
  attachments: number
  /** Whether the campaign's `[visualize]` script can be opened on this run
   * now: it has one, and the run has a report (convention §8.4). */
  visualizable: boolean
  error: string | null
}

/**
 * Runs, by the experiment they belong to and then by their id.
 *
 * Nested because a run id is only unique *within* its experiment (§10.1): it
 * is allocated as one past the highest that experiment already has, so two
 * experiments both have a run `1`. A flat map keyed by id would collide, and
 * would be claiming a global uniqueness nothing guarantees.
 *
 * This is also the shape the engine already holds internally
 * (`jobRecords: Map<folder, Map<run_id, ...>>`); the flat view was the odd one
 * out.
 */
export type RunsByEntity<T> = Record<string, Record<string, T>>

export interface World {
  entities: Entity[]
  job_runs: RunsByEntity<JobRun>
  campaign_runs: RunsByEntity<CampaignRun>
  /** Each experiment's run ids, oldest first — the index carries the order. */
  runs_by_job: Record<string, string[]>
  runs_by_campaign: Record<string, string[]>
  last_refresh: string | null
}

/** One job run, or `undefined`. The pair is the address; neither half alone. */
export function job_run(world: World, job_id: string, run_id: string): JobRun | undefined {
  return world.job_runs[job_id]?.[run_id]
}

export function campaign_run(
  world: World,
  campaign_id: string,
  run_id: string
): CampaignRun | undefined {
  return world.campaign_runs[campaign_id]?.[run_id]
}

export function empty_world(): World {
  return {
    entities: [],
    job_runs: {},
    campaign_runs: {},
    runs_by_job: {},
    runs_by_campaign: {},
    last_refresh: null
  }
}
