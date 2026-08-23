<script lang="ts">
  import { is_cancellable, is_terminal, job_run } from '@shared/world'
  import type { Crumb } from '../ui_state'
  import { app, entity_of, request_cancel, request_delete } from '../state.svelte'
  import Breadcrumbs from '../lib/Breadcrumbs.svelte'
  import RunFacts from '../lib/RunFacts.svelte'
  import StatusPill from '../lib/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'

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
      <Button
        variant="secondary"
        class="cancel ml-auto"
        onclick={() => request_cancel({ kind: 'job_run', job_id, run_id: run.id })}
      >
        Cancel Run
      </Button>
    {:else if is_terminal(run.status)}
      <Button
        variant="destructive"
        class="ml-auto"
        onclick={() => request_delete({ kind: 'job_run', job_id, run_id: run.id })}
      >
        Delete Run…
      </Button>
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

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--strong-foreground);
  }
</style>
