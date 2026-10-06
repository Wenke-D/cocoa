<script lang="ts">
  import { is_cancellable, is_deletable, job_run } from '@shared/world'
  import type { Crumb } from '../ui_state'
  import { app, entity_of, request_cancel, request_delete } from '../state.svelte'
  import Breadcrumbs from '../lib/components/Breadcrumbs.svelte'
  import RunFacts from '../lib/components/RunFacts.svelte'
  import StatusPill from '../lib/components/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'
  import SquareIcon from '@lucide/svelte/icons/square'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'

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
        size="icon-sm"
        variant="secondary"
        class="cancel ml-auto"
        title="Cancel Run"
        aria-label="Cancel Run"
        onclick={() => request_cancel({ kind: 'job_run', job_id, run_id: run.id })}
      >
        <SquareIcon />
      </Button>
    {:else if is_deletable(run)}
      <!-- A campaign-dispatched run has no Delete here: the fan-out is deleted
           whole, from the campaign run's page (§16.4). Nor has a failed run
           whose report is still being written (convention §12.1). -->
      <Button
        size="icon-sm"
        variant="destructive"
        class="ml-auto"
        title="Delete Run…"
        aria-label="Delete Run"
        onclick={() => request_delete({ kind: 'job_run', job_id, run_id: run.id })}
      >
        <Trash2Icon />
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
    margin-bottom: 24px;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--strong-foreground);
  }
</style>
