<script lang="ts">
  import {
    formatDuration,
    formatStartedAt,
    manifestBlockingReason,
    originLabel,
    triggerLabel
  } from '@shared/world'
  import { app, entityOf, navigate } from '../state.svelte'
  import StatusPill from '../lib/StatusPill.svelte'

  let { entityId }: { entityId: string } = $props()

  const entity = $derived(entityOf(entityId))
  const blocking = $derived(entity === undefined ? null : manifestBlockingReason(entity.manifest))

  const jobRuns = $derived(
    (app.world.runs_by_job[entityId] ?? [])
      .map((id) => app.world.job_runs[id])
      .filter((run) => run !== undefined)
      .reverse()
  )

  const benchRuns = $derived(
    (app.world.runs_by_bench[entityId] ?? [])
      .map((id) => app.world.bench_runs[id])
      .filter((run) => run !== undefined)
      .reverse()
  )
</script>

{#if entity !== undefined}
  <header>
    <span class="kind">{entity.kind === 'Job' ? 'JOB' : 'BENCH'}</span>
    <h1>{entity.name}</h1>
    <button
      class="start"
      disabled={blocking !== null}
      title={blocking ?? ''}
      onclick={() => navigate({ page: 'start', entityId })}
    >
      {entity.kind === 'Job' ? 'Start Job' : 'Start Bench'}
    </button>
  </header>
  <div class="path mono">{entity.path}</div>
  {#if blocking !== null}
    <div class="blocking">{blocking}</div>
  {/if}

  <h2>History</h2>
  {#if entity.kind === 'Job'}
    {#if jobRuns.length === 0}
      <p class="none">No runs yet.</p>
    {:else}
      <table>
        <thead>
          <tr><th>Run</th><th>Status</th><th>By</th><th>Started</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {#each jobRuns as run (run.id)}
            <tr onclick={() => navigate({ page: 'jobRun', jobId: entityId, runId: run.id })}>
              <td class="mono">{run.id}</td>
              <td><StatusPill status={run.status} health={run.query_health} /></td>
              <td>{originLabel(run.origin)}</td>
              <td>{formatStartedAt(run.started_at)}</td>
              <td class="mono">{formatDuration(run.started_at, run.ended_at, app.nowMs)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else if benchRuns.length === 0}
    <p class="none">No runs yet.</p>
  {:else}
    <table>
      <thead>
        <tr><th>Run</th><th>Status</th><th>By</th><th>Calls</th><th>Started</th><th>Duration</th></tr>
      </thead>
      <tbody>
        {#each benchRuns as run (run.id)}
          <tr onclick={() => navigate({ page: 'benchRun', benchId: entityId, runId: run.id })}>
            <td class="mono">{run.id}</td>
            <td><StatusPill status={run.status} health={run.query_health} /></td>
            <td>{triggerLabel(run.by)}</td>
            <td>{run.plan.steps.length}</td>
            <td>{formatStartedAt(run.started_at)}</td>
            <td class="mono">{formatDuration(run.started_at, run.ended_at, app.nowMs)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .kind {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--description);
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--strong-foreground);
    flex: 1;
  }

  .start {
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 3px;
    padding: 5px 14px;
    cursor: pointer;
  }

  .start:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .path {
    margin-top: 4px;
    color: var(--description);
  }

  .blocking {
    margin-top: 10px;
    color: var(--warning);
  }

  h2 {
    margin: 24px 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .none {
    color: var(--description);
    font-style: italic;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    text-align: left;
    font-weight: 500;
    font-size: 11px;
    color: var(--description);
    border-bottom: 1px solid var(--border);
    padding: 4px 10px 4px 0;
  }

  td {
    padding: 4px 10px 4px 0;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--row-hover);
  }
</style>
