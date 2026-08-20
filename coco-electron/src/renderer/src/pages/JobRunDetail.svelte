<script lang="ts">
  import { is_cancellable, job_run } from '@shared/world'
  import type { Crumb } from '@shared/ui'
  import { app, entity_of, request_cancel } from '../state.svelte'
  import Breadcrumbs from '../lib/Breadcrumbs.svelte'
  import RunFacts from '../lib/RunFacts.svelte'
  import StatusPill from '../lib/StatusPill.svelte'

  let { job_id, run_id }: { job_id: string; run_id: string } = $props()

  const run = $derived(job_run(app.world, job_id, run_id))
  const job = $derived(entity_of(job_id))

  const crumbs = $derived<Crumb[]>([
    { label: job?.name ?? '(removed)', route: { page: 'entity', entity_id: job_id } },
    { label: run_id, route: null, mono: true }
  ])
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <header>
    <h1 class="mono">{run.id}</h1>
    <StatusPill status={run.status} health={run.query_health} />
    {#if is_cancellable(run.status)}
      <button
        class="cancel secondary"
        onclick={() => request_cancel({ kind: 'job_run', job_id, run_id: run.id })}
      >
        Cancel Run
      </button>
    {/if}
  </header>

  <RunFacts {run} report_context={{ kind: 'job_run', job_id }} />
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
  }

  .cancel {
    margin-left: auto;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--strong-foreground);
  }
</style>
