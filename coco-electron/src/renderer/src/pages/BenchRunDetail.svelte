<script lang="ts">
  import {
    formatDuration,
    formatStartedAt,
    isCancellable,
    isTerminal,
    reportSummary,
    triggerLabel
  } from '@shared/world'
  import type { Crumb } from '@shared/ui'
  import { app, entityOf, navigate, requestCancel } from '../state.svelte'
  import Breadcrumbs from '../lib/Breadcrumbs.svelte'
  import StatusPill from '../lib/StatusPill.svelte'

  let { benchId, runId }: { benchId: string; runId: string } = $props()

  const run = $derived(app.world.bench_runs[runId])
  const bench = $derived(entityOf(benchId))

  const crumbs = $derived<Crumb[]>([
    { label: bench?.name ?? '(removed)', route: { page: 'entity', entityId: benchId } },
    { label: runId, route: null, mono: true }
  ])

  const finished = $derived.by(() => {
    if (run === undefined) return 0
    return run.plan.steps.filter((step) => {
      const child = app.world.job_runs[step.run_id]
      return child !== undefined && isTerminal(child.status)
    }).length
  })
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <header>
    <h1 class="mono">{run.id}</h1>
    <StatusPill status={run.status} health={run.query_health} />
    <span class="progress">{finished} / {run.plan.steps.length} finished</span>
    {#if isCancellable(run.status)}
      <button
        class="cancel secondary"
        onclick={() => requestCancel({ kind: 'benchRun', benchId, runId: run.id })}
      >
        Cancel Bench
      </button>
    {/if}
  </header>

  <dl>
    <dt>Started by</dt>
    <dd>{triggerLabel(run.by)}</dd>
    <dt>Started at</dt>
    <dd>{formatStartedAt(run.started_at)}</dd>
    <dt>Duration</dt>
    <dd class="mono">{formatDuration(run.started_at, run.ended_at, app.nowMs)}</dd>
    <dt>Input</dt>
    <dd class="mono params">{run.parameters === '' ? '(none)' : run.parameters}</dd>
    <dt>Report</dt>
    <dd>
      {reportSummary(run.report)}
      {#if typeof run.report === 'object' && 'Available' in run.report}
        <button
          class="link"
          onclick={() =>
            navigate({ page: 'report', context: { kind: 'benchRun', benchId }, runId: run.id })}
        >
          View report
        </button>
      {/if}
    </dd>
    {#if run.error !== null}
      <dt>Error</dt>
      <dd class="error">{run.error}</dd>
    {/if}
  </dl>

  <h2>Dispatched calls</h2>
  <table class="runs">
    <!-- Parameters last, and the remainder: it is the column whose content has
         no bound — a sweep is what varies it — so it gets the leftover width,
         and the leftover width belongs to the last column (§22.2). -->
    <colgroup>
      <col style="width: 44px" />
      <col style="width: 180px" />
      <col style="width: 116px" />
      <col />
    </colgroup>
    <thead>
      <tr><th>#</th><th>Job</th><th>Status</th><th>Parameters</th></tr>
    </thead>
    <tbody>
      {#each run.plan.steps as step (step.run_id)}
        {@const child = app.world.job_runs[step.run_id]}
        {@const jobName = entityOf(step.job_id)?.name ?? '(removed)'}
        <!-- The bench's context, not the job's: same run, other address
             (§2.3.1), and the Explorer stays on the bench (§19). -->
        <tr
          onclick={() =>
            navigate({
              page: 'benchChild',
              benchId,
              benchRunId: run.id,
              runId: step.run_id
            })}
        >
          <td>{step.index}</td>
          <td title={jobName}>{jobName}</td>
          <td>
            {#if child !== undefined}
              <StatusPill status={child.status} health={child.query_health} />
            {:else}
              <span class="missing">not listed</span>
            {/if}
          </td>
          <td class="mono" title={step.parameters}>{step.parameters}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .progress {
    color: var(--description);
  }

  .cancel {
    margin-left: auto;
  }

  dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    max-width: 640px;
  }

  dt {
    color: var(--description);
  }

  dd {
    margin: 0;
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

  .error {
    color: var(--error);
    user-select: text;
  }

  h2 {
    margin: 24px 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .missing {
    color: var(--description);
    font-style: italic;
  }
</style>
