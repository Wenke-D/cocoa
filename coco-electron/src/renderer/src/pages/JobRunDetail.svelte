<script lang="ts">
  import { isCancellable, jobRun } from '@shared/world'
  import type { Crumb } from '@shared/ui'
  import { app, entityOf, requestCancel } from '../state.svelte'
  import Breadcrumbs from '../lib/Breadcrumbs.svelte'
  import RunFacts from '../lib/RunFacts.svelte'
  import StatusPill from '../lib/StatusPill.svelte'

  let { jobId, runId }: { jobId: string; runId: string } = $props()

  const run = $derived(jobRun(app.world, jobId, runId))
  const job = $derived(entityOf(jobId))

  const crumbs = $derived<Crumb[]>([
    { label: job?.name ?? '(removed)', route: { page: 'entity', entityId: jobId } },
    { label: runId, route: null, mono: true }
  ])
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <header>
    <h1 class="mono">{run.id}</h1>
    <StatusPill status={run.status} health={run.query_health} />
    {#if isCancellable(run.status)}
      <button
        class="cancel secondary"
        onclick={() => requestCancel({ kind: 'jobRun', jobId, runId: run.id })}
      >
        Cancel Run
      </button>
    {/if}
  </header>

  <RunFacts {run} reportContext={{ kind: 'jobRun', jobId }} />
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
