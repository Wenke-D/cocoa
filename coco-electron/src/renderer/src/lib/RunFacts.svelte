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
    formatDuration,
    formatRelative,
    formatStartedAt,
    originLabel,
    queryAvailable,
    reportSummary
  } from '@shared/world'
  import type { JobRun } from '@shared/world'
  import type { ReportContext } from '@shared/ui'
  import { app, navigate } from '../state.svelte'

  let {
    run,
    reportContext,
    leading
  }: { run: JobRun; reportContext: ReportContext; leading?: Snippet } = $props()
</script>

<dl>
  {@render leading?.()}
  <dt>Started by</dt>
  <dd>{originLabel(run.origin)}</dd>
  <dt>Started at</dt>
  <dd>{formatStartedAt(run.started_at)}</dd>
  <dt>Duration</dt>
  <dd class="mono">{formatDuration(run.started_at, run.ended_at, app.nowMs)}</dd>
  <dt>Parameters</dt>
  <dd class="mono params">{run.parameters === '' ? '(none)' : run.parameters}</dd>
  <dt>Report</dt>
  <dd>
    {reportSummary(run.report)}
    {#if typeof run.report === 'object' && 'Available' in run.report}
      <button
        class="link"
        onclick={() => navigate({ page: 'report', context: reportContext, runId: run.id })}
      >
        View report
      </button>
    {/if}
  </dd>
  {#if !queryAvailable(run.query_health)}
    <dt>Query</dt>
    <dd class="warning">
      Status is unknown — last successful query {formatRelative(
        run.last_successful_query,
        app.nowMs
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
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    max-width: 640px;
  }

  dl :global(dt) {
    color: var(--description);
  }

  dl :global(dd) {
    margin: 0;
    color: var(--foreground);
  }

  .link {
    margin-left: 8px;
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    cursor: pointer;
  }

  .params {
    background: var(--code-bg);
    padding: 4px 8px;
    border-radius: 3px;
    user-select: text;
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
