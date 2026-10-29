// Where the page is: an address, never content.

import type { ReportFormat } from '@shared/world'

/**
 * Which page a report was opened from. A run dispatched by a campaign has two
 * addresses (§2.3.1), so the report of one run does too: the context, not the
 * run's origin, decides the breadcrumbs and which Explorer row stays
 * selected.
 */
export type ReportContext =
  | { kind: 'job_run'; job_id: string }
  | { kind: 'campaign_run'; campaign_id: string }
  | { kind: 'campaign_child'; campaign_id: string; campaign_run_id: string; job_id: string }

/** An address, never content. */
export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entity_id: string }
  | { page: 'start'; entity_id: string }
  | { page: 'job_run'; job_id: string; run_id: string }
  | { page: 'campaign_run'; campaign_id: string; run_id: string }
  /**
   * A run dispatched by a campaign, seen in the campaign's context (§19). Its
   * job is part of the address: run ids are per job, so two calls of one
   * campaign run can both be run 0.
   */
  | {
      page: 'campaign_child'
      campaign_id: string
      campaign_run_id: string
      job_id: string
      run_id: string
    }
  | { page: 'report'; context: ReportContext; run_id: string; format: ReportFormat }

/**
 * One breadcrumb. `route` is `null` for the
 * trailing crumb: the page you are already on is not a link.
 */
export interface Crumb {
  label: string
  route: Route | null
  /** Run ids and parameters are code; names are not. */
  mono?: boolean
}
