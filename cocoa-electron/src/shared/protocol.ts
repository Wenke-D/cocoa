// What the main process sends and answers over IPC.
//
// The protocol is event-driven: the backend is the only party that judges
// change. The renderer bootstraps once (the one irreducible full-state
// message — a fresh page owns nothing), then applies events. Events from one
// logical operation arrive as ONE batch, so the renderer never sees a torn
// world (a member succeeded while its campaign still reads running).

import type { CampaignRun, Entity, JobRun, ReportFormat, World } from './world'

export interface BootstrapPayload {
  world: World
}

/**
 * How loudly a notice speaks. `error` is styled as a failure and stays until
 * it is dismissed or replaced — a message nobody had time to read is the same as
 * no message at all.
 */
export type NoticeLevel = 'info' | 'error'

export type CocoaEvent =
  | { kind: 'entity-upserted'; entity: Entity }
  | { kind: 'entity-removed'; id: string }
  /** The run carries its own `job_id`, so an upsert needs nothing else. */
  | { kind: 'job-run-upserted'; run: JobRun }
  /** A removal has no run to carry the pair, so it names both halves. */
  | { kind: 'job-run-removed'; job_id: string; id: string }
  | { kind: 'campaign-run-upserted'; run: CampaignRun }
  | { kind: 'campaign-run-removed'; campaign_id: string; id: string }
  /** Heartbeat: the engine completed a refresh pass. Content-free. */
  | { kind: 'refreshed'; at: string }
  /**
   * Something the user should be told, in one sentence. The transient
   * message is the only place a failed refresh can report itself — a poll
   * script that will not run is not visible anywhere else, because there is
   * no run whose row could carry it.
   */
  | { kind: 'notice'; level: NoticeLevel; text: string }

export type StartResult = { ok: true; run_id: string } | { ok: false; message: string }

/**
 * What a cancel is aimed at. A modal is a temporary action, not a place, so
 * this is never part of a route (specification §9).
 */
export type CancelTarget =
  | { kind: 'job_run'; job_id: string; run_id: string }
  | { kind: 'campaign_run'; campaign_id: string; run_id: string }

export type CancelResult = { ok: true } | { ok: false; message: string }

/** The run to delete for good (§16.4): same two addresses a cancel uses. */
export type DeleteTarget =
  | { kind: 'job_run'; job_id: string; run_id: string }
  | { kind: 'campaign_run'; campaign_id: string; run_id: string }

export type DeleteResult = { ok: true } | { ok: false; message: string }

/** A job run's or a campaign run's report to regenerate by hand (convention
 * §7.3.2, §8.3). The entity id is the folder it lives in. */
export interface RerunReportTarget {
  entity_id: string
  run_id: string
}

/** Accepted means due: the report runs on the next tick, and the world says
 * `Generating` until it lands. */
export type RerunReportResult = { ok: true } | { ok: false; message: string }

/** A job run's or a campaign run's report to lock or unlock (convention
 * §7.3.3). The entity id is the folder it lives in. */
export interface LockReportTarget {
  entity_id: string
  run_id: string
  locked: boolean
}

export type LockReportResult = { ok: true } | { ok: false; message: string }

/** Which run's report to read, and which of its files. The entity id is the
 * folder it lives in. */
export interface ReportTarget {
  entity_id: string
  run_id: string
  format: ReportFormat
}

/** Which run's report to save a copy of, wherever the person picks. */
export interface SaveReportTarget {
  entity_id: string
  run_id: string
}

export type SaveReportResult =
  | { ok: true; path: string }
  /** `cancelled` is not a failure: closing the dialog saves nothing, and says nothing. */
  | { ok: false; cancelled: boolean; message: string }

/** Which run's report attachments to open in the system file manager. */
export interface AttachmentsTarget {
  entity_id: string
  run_id: string
}

export type OpenAttachmentsResult = { ok: true } | { ok: false; message: string }

/** Which run to open the experiment's `[visualize]` script on. */
export interface VisualizeTarget {
  entity_id: string
  run_id: string
}

/** Started, or refused; a viewer that fails later is a notice of its own. */
export type VisualizeResult = { ok: true } | { ok: false; message: string }

export type AddFolderResult =
  /** `already` distinguishes "registered it" from "it was already there" —
   * a folder already in the Explorer is a no-op, never a duplicate (§11.5). */
  | { ok: true; entity_id: string; already: boolean }
  /** `cancelled` is not a failure: cancelling the picker does nothing at all. */
  | { ok: false; cancelled: boolean; message: string }

export type RemoveFolderResult = { ok: true } | { ok: false; message: string }

export type ReportResult =
  { ok: true; format: ReportFormat; text: string } | { ok: false; message: string }
