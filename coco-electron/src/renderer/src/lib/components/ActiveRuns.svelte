<!--
  Everything started and not yet finished (§11.1): top-level runs, newest
  first, each row leading to the run's detail page, where Cancel lives. A
  bench run appears once and is counted once; the members it still has
  running are listed beneath it, indented, as what it is made of.
-->
<script lang="ts">
  import { is_active, job_run } from '@shared/world'
  import type { QueryHealth, RunStatus } from '@shared/world'
  import { app, entity_of, navigate } from '../../state.svelte'
  import type { Route } from '../../state.svelte'
  import StatusPill from './StatusPill.svelte'
  import ViewTitle from './ViewTitle.svelte'

  interface Row {
    key: string
    name: string
    id: string
    started_at: string
    status: RunStatus
    health: QueryHealth
    route: Route
    members: Row[]
  }

  const rows = $derived.by(() => {
    const world = app.world
    const rows: Row[] = []
    for (const runs of Object.values(world.job_runs)) {
      for (const run of Object.values(runs)) {
        if (is_active(run.status) && (run.origin === 'Human' || run.origin === 'Agent')) {
          rows.push({
            key: `job ${run.job_id} ${run.id}`,
            name: entity_of(run.job_id)?.name ?? '(removed)',
            id: run.id,
            started_at: run.started_at,
            status: run.status,
            health: run.query_health,
            route: { page: 'job_run', job_id: run.job_id, run_id: run.id },
            members: []
          })
        }
      }
    }
    for (const runs of Object.values(world.bench_runs)) {
      for (const run of Object.values(runs)) {
        if (!is_active(run.status)) {
          continue
        }
        const members: Row[] = []
        for (const step of run.plan.steps) {
          const member = job_run(world, step.job_id, step.run_id)
          if (member !== undefined && is_active(member.status)) {
            members.push({
              key: `member ${step.job_id} ${step.run_id}`,
              name: entity_of(step.job_id)?.name ?? '(removed)',
              id: member.id,
              started_at: member.started_at,
              status: member.status,
              health: member.query_health,
              // Seen through the bench (§19): the Explorer stays on the bench.
              route: {
                page: 'bench_child',
                bench_id: run.bench_id,
                bench_run_id: run.id,
                run_id: member.id
              },
              members: []
            })
          }
        }
        rows.push({
          key: `bench ${run.bench_id} ${run.id}`,
          name: entity_of(run.bench_id)?.name ?? '(removed)',
          id: run.id,
          started_at: run.started_at,
          status: run.status,
          health: run.query_health,
          route: { page: 'bench_run', bench_id: run.bench_id, run_id: run.id },
          members
        })
      }
    }
    rows.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    return rows
  })
</script>

{#snippet row(entry: Row, member: boolean)}
  <button class="row" class:member onclick={() => navigate(entry.route)}>
    <span class="name">{entry.name}</span>
    <span class="id mono">{entry.id}</span>
    <StatusPill status={entry.status} health={entry.health} />
  </button>
{/snippet}

<ViewTitle title="ACTIVE RUNS" />
<div class="list">
  {#each rows as entry (entry.key)}
    {@render row(entry, false)}
    {#each entry.members as child (child.key)}
      {@render row(child, true)}
    {/each}
  {:else}
    <div class="empty">Nothing is running.</div>
  {/each}
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 26px;
    padding: 0 16px;
    border: none;
    background: none;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }

  .row.member {
    padding-left: 32px;
    height: 24px;
    color: var(--description);
  }

  .row:hover {
    background: var(--row-hover);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .id {
    color: var(--description);
  }

  .empty {
    padding: 2px 16px;
    color: var(--description);
    font-style: italic;
  }
</style>
