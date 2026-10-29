<!--
  Everything started and not yet finished (§11.1): top-level runs, newest
  first, each row leading to the run's detail page, where Cancel lives. A
  campaign run appears once and is counted once; the members it still has
  running are listed beneath it, indented, as what it is made of.
-->
<script lang="ts">
  import { is_active } from '@shared/run_status'
  import { job_run } from '@shared/world'
  import type { QueryHealth, RunStatus } from '@shared/world'
  import { navigate } from '../../navigation'
  import { app } from '../../state.svelte'
  import { entity_name, entity_of } from '../../world_queries'
  import type { Route } from '../../route'
  import type { EntityKind } from '@shared/world'
  import KindIcon from './KindIcon.svelte'
  import StatusPill from './StatusPill.svelte'
  import ViewTitle from './ViewTitle.svelte'

  interface Row {
    key: string
    kind: EntityKind
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
            kind: 'Job',
            name: entity_name(entity_of(run.job_id)),
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
    for (const runs of Object.values(world.campaign_runs)) {
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
              kind: 'Job',
              name: entity_name(entity_of(step.job_id)),
              id: member.id,
              started_at: member.started_at,
              status: member.status,
              health: member.query_health,
              // Seen through the campaign (§19): the Explorer stays on the campaign.
              route: {
                page: 'campaign_child',
                campaign_id: run.campaign_id,
                campaign_run_id: run.id,
                job_id: step.job_id,
                run_id: member.id
              },
              members: []
            })
          }
        }
        rows.push({
          key: `campaign ${run.campaign_id} ${run.id}`,
          kind: 'Campaign',
          name: entity_name(entity_of(run.campaign_id)),
          id: run.id,
          started_at: run.started_at,
          status: run.status,
          health: run.query_health,
          route: { page: 'campaign_run', campaign_id: run.campaign_id, run_id: run.id },
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
    {#if !member}
      <KindIcon kind={entry.kind} size={15} />
    {/if}
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
    padding: 0 6px 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 28px;
    padding: 0 8px 0 12px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }

  .row :global(svg) {
    flex-shrink: 0;
  }

  .row.member {
    padding-left: 35px;
    height: 26px;
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
    padding: 2px 12px;
    color: var(--description);
    font-style: italic;
  }
</style>
