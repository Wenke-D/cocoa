// How the renderer words and formats the view model.

import type {
  ManifestState,
  QueryHealth,
  ReportFormat,
  ReportState,
  RunDeploy,
  RunOrigin,
  RunStatus,
  Trigger
} from '@shared/world'

export function query_available(health: QueryHealth): boolean {
  return typeof health === 'string' || !('Unavailable' in health)
}

/** Mirrors `JobRun::display_status`: unavailable query shows Unknown. */
export function display_status(status: RunStatus, health: QueryHealth): string {
  return query_available(health) ? status : 'Unknown'
}

export function manifest_blocking_reason(state: ManifestState): string | null {
  if (state === 'Valid') {
    return null
  }
  if (state === 'Missing') {
    return 'No manifest was found in this folder.'
  }
  return `Manifest is invalid: ${state.Invalid.message}`
}

/** Mirrors `RunOrigin`'s history-row label: `you`, `agent`, or the Campaign. */
export function origin_label(origin: RunOrigin): string {
  if (origin === 'Human') {
    return 'you'
  }
  if (origin === 'Agent') {
    return 'agent'
  }
  return `${origin.Campaign.name} · call ${origin.Campaign.call}`
}

export function trigger_label(by: Trigger): string {
  return by === 'Human' ? 'you' : 'agent'
}

/** What a run's start found and did about its job's deploy (§7.5, §7.6). */
export function deploy_summary(deploy: RunDeploy): string {
  if (deploy.check === 'CURRENT') {
    return 'Up to date'
  }
  if (deploy.error !== null) {
    return 'Deploy failed'
  }
  if (deploy.at === null) {
    return 'Deploying…'
  }
  return `Deployed ${format_started_at(deploy.at)}`
}

/** A report format as the page names it. */
export function format_label(format: ReportFormat): string {
  return format === 'Html' ? 'HTML' : 'Plain text'
}

export function report_summary(report: ReportState): string {
  if (report === 'Unavailable') {
    return 'Report is not yet available.'
  }
  if (report === 'Generating') {
    return 'Report is being generated.'
  }
  if (report === 'Missing') {
    return 'Report is missing.'
  }
  if ('Available' in report) {
    const labels = report.Available.files.map((file) => format_label(file.format))
    return `${labels.join(' and ')} report is available.`
  }
  return `Unable to read report: ${report.ReadError.message}`
}

/**
 * How long a run has taken: `HH:MM:SS` while it runs — a clock, ticking off
 * `now_ms` — and `1h 12m 33s` once it has ended, a length with its empty
 * leading units dropped. A finished run's duration is a fact, not a clock,
 * and `00:00:00` reads as one still to start (§22.2).
 */
export function format_duration(
  started_at: string,
  ended_at: string | null,
  now_ms: number
): string {
  const start = Date.parse(started_at)
  const end = ended_at !== null ? Date.parse(ended_at) : now_ms
  const total = Math.max(0, Math.floor((end - start) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (ended_at === null) {
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }
  const parts: string[] = []
  if (h > 0) {
    parts.push(`${h}h`)
  }
  if (h > 0 || m > 0) {
    parts.push(`${m}m`)
  }
  parts.push(`${s}s`)
  return parts.join(' ')
}

const DAY_SECONDS = 86400

/** The units of `format_relative`, longest first; a month is thirty days and a year 365. */
const RELATIVE_UNITS: readonly (readonly [number, string])[] = [
  [365 * DAY_SECONDS, 'year'],
  [30 * DAY_SECONDS, 'month'],
  [DAY_SECONDS, 'day'],
  [3600, 'hour'],
  [60, 'minute']
]

/** "38 seconds ago", "2 days ago": the largest unit that fits, whole, and never the next one down. */
export function format_relative(then: string, now_ms: number): string {
  const seconds = Math.max(0, Math.floor((now_ms - Date.parse(then)) / 1000))
  if (seconds === 0) {
    return 'just now'
  }
  for (const [length, unit] of RELATIVE_UNITS) {
    if (seconds >= length) {
      const count = Math.floor(seconds / length)
      return `${count} ${unit}${count === 1 ? '' : 's'} ago`
    }
  }
  return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`
}

/** `HH:MM:SS` in local time, as the cancel modal states a start (§16.1). */
export function format_clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function format_started_at(started_at: string): string {
  const date = new Date(started_at)
  if (Number.isNaN(date.getTime())) {
    return started_at
  }
  return date.toLocaleString()
}
