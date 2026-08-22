<script lang="ts">
  import {
    format_duration,
    format_started_at,
    manifest_blocking_reason,
    origin_label,
    trigger_label
  } from '@shared/world'
  import { bench_run, job_run } from '@shared/world'
  import { app, entity_of, navigate } from '../state.svelte'
  import StatusPill from '../lib/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'

  let { entity_id }: { entity_id: string } = $props()

  const entity = $derived(entity_of(entity_id))
  const blocking = $derived(entity === undefined ? null : manifest_blocking_reason(entity.manifest))

  const job_runs = $derived(
    (app.world.runs_by_job[entity_id] ?? [])
      .map((id) => job_run(app.world, entity_id, id))
      .filter((run) => run !== undefined)
      .reverse()
  )

  const bench_runs = $derived(
    (app.world.runs_by_bench[entity_id] ?? [])
      .map((id) => bench_run(app.world, entity_id, id))
      .filter((run) => run !== undefined)
      .reverse()
  )
</script>

{#if entity !== undefined}
  <header>
    <span class="kind">{entity.kind === 'Job' ? 'JOB' : 'BENCH'}</span>
    <h1>{entity.name}</h1>
    <Button
      class="start"
      disabled={blocking !== null}
      title={blocking ?? ''}
      onclick={() => navigate({ page: 'start', entity_id })}
    >
      {entity.kind === 'Job' ? 'Start Job' : 'Start Bench'}
    </Button>
  </header>
  <div class="path mono">{entity.path}</div>
  {#if blocking !== null}
    <div class="blocking">{blocking}</div>
  {/if}

  <h2>History</h2>
  {#if entity.kind === 'Job'}
    {#if job_runs.length === 0}
      <p class="none">No runs yet.</p>
    {:else}
      <table class="runs">
        <!-- Sized for the widest value each column actually holds: `CANCELLING`
             with its dot, a bench name and call number, a locale timestamp.
             The slack goes to the *last* column, so on a wide window the empty
             space collects at the table's edge instead of opening a gap in the
             middle of every row. Duration only ever needs `HH:MM:SS`. -->
        <colgroup>
          <col style="width: 72px" />
          <col style="width: 116px" />
          <col style="width: 240px" />
          <col style="width: 190px" />
          <col />
        </colgroup>
        <thead>
          <tr><th>Run</th><th>Status</th><th>By</th><th>Started</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {#each job_runs as run (run.id)}
            <tr onclick={() => navigate({ page: 'job_run', job_id: entity_id, run_id: run.id })}>
              <td class="mono">{run.id}</td>
              <td><StatusPill status={run.status} health={run.query_health} /></td>
              <td title={origin_label(run.origin)}>{origin_label(run.origin)}</td>
              <td title={format_started_at(run.started_at)}>{format_started_at(run.started_at)}</td>
              <td class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else if bench_runs.length === 0}
    <p class="none">No runs yet.</p>
  {:else}
    <table class="runs">
      <colgroup>
        <col style="width: 72px" />
        <col style="width: 116px" />
        <col style="width: 240px" />
        <col style="width: 60px" />
        <col style="width: 190px" />
        <col />
      </colgroup>
      <thead>
        <tr
          ><th>Run</th><th>Status</th><th>By</th><th>Calls</th><th>Started</th><th>Duration</th></tr
        >
      </thead>
      <tbody>
        {#each bench_runs as run (run.id)}
          <tr onclick={() => navigate({ page: 'bench_run', bench_id: entity_id, run_id: run.id })}>
            <td class="mono">{run.id}</td>
            <td><StatusPill status={run.status} health={run.query_health} /></td>
            <td title={trigger_label(run.by)}>{trigger_label(run.by)}</td>
            <td>{run.plan.steps.length}</td>
            <td title={format_started_at(run.started_at)}>{format_started_at(run.started_at)}</td>
            <td class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</td>
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
    margin: 0;
    color: var(--description);
    font-style: italic;
  }
</style>
