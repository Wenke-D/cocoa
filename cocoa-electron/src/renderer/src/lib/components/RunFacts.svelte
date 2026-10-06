<!--
  The facts of one job run, rendered identically wherever that run is seen.

  A run dispatched by a bench has two addresses (§2.3.1) and this is the part
  that must not differ between them: §19 says the two pages "must present
  identical facts", and the only way to be sure of that is for there to be one
  of them. What differs — breadcrumbs, which Explorer row stays selected, the
  report's context, and the rows a bench adds in front — is passed in.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    format_duration,
    format_relative,
    format_started_at,
    origin_label,
    query_available
  } from '@shared/world'
  import type { JobRun, ReportFormat } from '@shared/world'
  import type { ReportContext } from '../../ui_state'
  import { app, navigate, rerun_report } from '../../state.svelte'
  import ReportButtons from './ReportButtons.svelte'

  let {
    run,
    report_context,
    leading
  }: { run: JobRun; report_context: ReportContext; leading?: Snippet } = $props()
</script>

<dl>
  {@render leading?.()}
  <dt>Started by</dt>
  <dd>{origin_label(run.origin)}</dd>
  <dt>Started at</dt>
  <dd>{format_started_at(run.started_at)}</dd>
  <dt>Duration</dt>
  <dd class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</dd>
  <dt>Arguments</dt>
  <dd class="mono params">{run.parameters === '' ? '(none)' : run.parameters}</dd>
  <dt>Report</dt>
  <dd>
    <ReportButtons
      report={run.report}
      error={run.report_error}
      open={(format: ReportFormat) =>
        navigate({ page: 'report', context: report_context, run_id: run.id, format })}
      rerun={run.report_rerunnable
        ? () => rerun_report({ job_id: run.job_id, run_id: run.id })
        : null}
    />
  </dd>
  {#if !query_available(run.query_health)}
    <dt>Query</dt>
    <dd class="warning">
      Status is unknown — last successful query {format_relative(
        run.last_successful_query,
        app.now_ms
      )}. Last known status: {run.status}.
    </dd>
  {/if}
  {#if run.error !== null}
    <dt>Error</dt>
    <dd class="error">{run.error}</dd>
  {/if}
</dl>

<style>
  dl {
    display: grid;
    grid-template-columns: 140px 1fr;
    align-items: baseline;
    gap: 14px 24px;
    max-width: 880px;
    font-size: 15px;
  }

  /* Code-like values (durations, arguments) one step below the prose beside
     them, as everywhere else — not the app's 12px table size. */
  dl :global(.mono) {
    font-size: 14px;
  }

  dl :global(dt) {
    color: var(--description);
  }

  dl :global(dd) {
    margin: 0;
    color: var(--foreground);
  }

  .warning {
    color: var(--warning);
  }

  .error {
    color: var(--error);
    user-select: text;
  }

  dl :global(.job-link) {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--link);
    cursor: pointer;
  }
</style>
