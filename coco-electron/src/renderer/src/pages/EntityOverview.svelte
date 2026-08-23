<script lang="ts">
  import {
    format_duration,
    is_terminal,
    format_relative,
    format_started_at,
    manifest_blocking_reason,
    origin_label,
    trigger_label
  } from '@shared/world'
  import { bench_run, job_run } from '@shared/world'
  import { describe_values } from '@shared/params'
  import { app, entity_of, navigate, request_remove } from '../state.svelte'
  import HistoryRow from '../lib/HistoryRow.svelte'
  import StatusPill from '../lib/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'
  import FolderMinusIcon from '@lucide/svelte/icons/folder-minus'
  import PlayIcon from '@lucide/svelte/icons/play'

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
  <!-- Top to bottom: what it is called, what it is for, where it is; then
       what it takes, as a table — name, shape, description — since a
       parameter is read before it is filled in (§13.1). No kind label: the
       Start button below says "Job" or "Bench", and so does the Explorer
       section the row came from. -->
  <header>
    <h1>{entity.name}</h1>
    {#if entity.description !== null}
      <p class="description">{entity.description}</p>
    {/if}
    <div class="path mono">{entity.path}</div>
    {#if blocking !== null}
      <div class="blocking">{blocking}</div>
    {/if}
  </header>

  {#if blocking === null}
    <h2>Parameters</h2>
    {#if entity.parameters.length === 0}
      <p class="none">No parameters.</p>
    {:else}
      <table class="specs">
        <thead>
          <tr><th>Name</th><th>Values</th><th>Description</th></tr>
        </thead>
        <tbody>
          {#each entity.parameters as spec (spec.name)}
            <tr>
              <td class="mono name">{spec.name}</td>
              <td class="shape">{describe_values(spec)}</td>
              <td>{spec.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  <!-- Every action on the experiment itself, in one place (§13.1). Remove
       stays available when the manifest is broken — a folder that cannot
       start is exactly one someone may want out of the Explorer. -->
  <h2>Actions</h2>
  {@const start_label = entity.kind === 'Job' ? 'Start Job' : 'Start Bench'}
  <div class="actions">
    <Button
      size="icon-sm"
      class="start"
      disabled={blocking !== null}
      title={blocking ?? start_label}
      aria-label={start_label}
      onclick={() => navigate({ page: 'start', entity_id })}
    >
      <PlayIcon />
    </Button>
    <Button
      size="icon-sm"
      variant="secondary"
      title="Remove from Explorer"
      aria-label="Remove from Explorer"
      onclick={() => request_remove(entity_id)}
    >
      <FolderMinusIcon />
    </Button>
  </div>

  <h2>History</h2>
  {#if entity.kind === 'Job'}
    {#if job_runs.length === 0}
      <p class="none">No runs yet.</p>
    {:else}
      <table class="runs">
        <!-- Sized for the widest value each column actually holds: the status
             dot, a run id, `120h 59m 59s`, `59 minutes ago`. Arguments is the
             one column with no bound — a sweep is what varies them — so it is
             the one left unsized and takes what is left, right after the id,
             since it is what tells runs apart (§22.2). -->
        <colgroup>
          <col style="width: 22px" />
          <col style="width: 54px" />
          <col />
          <col style="width: 100px" />
          <col style="width: 116px" />
          <col style="width: 80px" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Status"></th><th class="num">Run</th><th class="over-params"
              >Arguments</th
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
              deletable={is_terminal(run.status) && typeof run.origin === 'string'}
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
        <col style="width: 54px" />
        <col />
        <col style="width: 100px" />
        <col style="width: 116px" />
        <col style="width: 80px" />
      </colgroup>
      <thead>
        <tr>
          <th aria-label="Status"></th><th class="num">Run</th><th class="over-params">Arguments</th
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
            deletable={is_terminal(run.status)}
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

  /* One row per parameter: its name, what may be put there, what it is
     for. Not a
     `.runs` table — nothing here is a row to click or a column that must
     not jitter — but it borrows the heading look, so the three columns are
     named and the last one is known to be the description. Name and type
     take their widest value, the description what is left. */
  .specs {
    border-collapse: collapse;
    max-width: 720px;
  }

  .specs th {
    text-align: left;
    font-weight: 500;
    font-size: 11px;
    color: var(--description);
    border-bottom: 1px solid var(--border);
    padding: 4px 20px 4px 0;
  }

  .specs td {
    padding: 5px 20px 5px 0;
    vertical-align: top;
  }

  .specs .name {
    color: var(--strong-foreground);
    white-space: nowrap;
  }

  .specs .shape {
    color: var(--description);
    white-space: nowrap;
  }

  .path {
    color: var(--description);
  }

  .blocking {
    margin-top: 4px;
    color: var(--warning);
  }

  .actions {
    display: flex;
    gap: 8px;
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
