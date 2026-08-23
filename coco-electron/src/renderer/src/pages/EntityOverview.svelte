<script lang="ts">
  import {
    format_duration,
    format_relative,
    format_started_at,
    manifest_blocking_reason,
    origin_label,
    trigger_label
  } from '@shared/world'
  import { bench_run, job_run } from '@shared/world'
  import { app, entity_of, navigate } from '../state.svelte'
  import HistoryRow from '../lib/HistoryRow.svelte'
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
  <!-- Top to bottom: what it is called, what it is for, what it takes, where
       it is (§13.1). No kind label: the Start button below says "Job" or
       "Bench", and so does the Explorer section the row came from. -->
  <header>
    <h1>{entity.name}</h1>
    {#if entity.description !== null}
      <p class="description">{entity.description}</p>
    {/if}
    {#if blocking === null}
      <div class="parameters">
        {#each entity.parameter_names as name (name)}
          <span class="param mono">{name}</span>
        {:else}
          <span class="none">No parameters.</span>
        {/each}
      </div>
    {/if}
    <div class="path mono">{entity.path}</div>
    {#if blocking !== null}
      <div class="blocking">{blocking}</div>
    {/if}
  </header>
  <div class="actions">
    <Button
      disabled={blocking !== null}
      title={blocking ?? ''}
      onclick={() => navigate({ page: 'start', entity_id })}
    >
      {entity.kind === 'Job' ? 'Start Job' : 'Start Bench'}
    </Button>
  </div>

  <h2>History</h2>
  {#if entity.kind === 'Job'}
    {#if job_runs.length === 0}
      <p class="none">No runs yet.</p>
    {:else}
      <table class="runs">
        <!-- Sized for the widest value each column actually holds: the status
             dot, a run id, `120h 59m 59s`, `59 minutes ago`. Parameters is the
             one column with no bound — a sweep is what varies them — so it is
             the one left unsized and takes what is left, right after the id,
             since it is what tells runs apart (§22.2). -->
        <colgroup>
          <col style="width: 22px" />
          <col style="width: 44px" />
          <col />
          <col style="width: 100px" />
          <col style="width: 116px" />
          <col style="width: 80px" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Status"></th><th class="num">Run</th><th class="over-params"
              >Parameters</th
            >
            <th>Duration</th><th>Started</th><th>By</th>
          </tr>
        </thead>
        <tbody>
          {#each job_runs as run (run.id)}
            <HistoryRow
              {entity_id}
              run_id={run.id}
              params={run.params}
              route={{ page: 'job_run', job_id: entity_id, run_id: run.id }}
            >
              <td><StatusPill status={run.status} health={run.query_health} compact /></td>
              <td class="mono num">{run.id}</td>
              <td title={run.parameters}>
                {#if run.parameters !== ''}<span class="mono params">{run.parameters}</span>{/if}
              </td>
              <td class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</td>
              <td title={format_started_at(run.started_at)}>
                {format_relative(run.started_at, app.now_ms)}
              </td>
              <td title={origin_label(run.origin)}>{origin_label(run.origin)}</td>
            </HistoryRow>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else if bench_runs.length === 0}
    <p class="none">No runs yet.</p>
  {:else}
    <table class="runs">
      <colgroup>
        <col style="width: 22px" />
        <col style="width: 44px" />
        <col />
        <col style="width: 100px" />
        <col style="width: 116px" />
        <col style="width: 80px" />
      </colgroup>
      <thead>
        <tr>
          <th aria-label="Status"></th><th class="num">Run</th><th class="over-params"
            >Parameters</th
          >
          <th>Duration</th><th>Started</th><th>By</th>
        </tr>
      </thead>
      <tbody>
        {#each bench_runs as run (run.id)}
          <HistoryRow
            {entity_id}
            run_id={run.id}
            params={run.params}
            route={{ page: 'bench_run', bench_id: entity_id, run_id: run.id }}
          >
            <td><StatusPill status={run.status} health={run.query_health} compact /></td>
            <td class="mono num">{run.id}</td>
            <td title={run.parameters}>
              {#if run.parameters !== ''}<span class="mono params">{run.parameters}</span>{/if}
            </td>
            <td class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</td>
            <td title={format_started_at(run.started_at)}>
              {format_relative(run.started_at, app.now_ms)}
            </td>
            <td title={trigger_label(run.by)}>{trigger_label(run.by)}</td>
          </HistoryRow>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .description {
    margin: 0;
    max-width: 640px;
  }

  .parameters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* A declared parameter's name, on inline code's ground like a run's values (§22.2). */
  .param {
    background: var(--code-inline-bg);
    border-radius: 3px;
    padding: 1px 6px;
  }

  .path {
    color: var(--description);
  }

  .blocking {
    margin-top: 4px;
    color: var(--warning);
  }

  .actions {
    margin-top: 14px;
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
