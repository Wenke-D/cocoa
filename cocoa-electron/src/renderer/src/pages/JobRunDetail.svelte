<script lang="ts">
  import { is_cancellable, is_deletable } from '@shared/run_status'
  import { job_run } from '@shared/world'
  import type { Crumb } from '../route'
  import { request_cancel, request_delete } from '../overlays.svelte'
  import { app } from '../state.svelte'
  import { entity_name, entity_of } from '../world_queries'
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
    { label: entity_name(job), route: { page: 'entity', entity_id: job_id } },
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
        <SquareIcon />Cancel Run
      </Button>
    {:else if is_deletable(run)}
      <!-- A campaign-dispatched run has no Delete here: the fan-out is deleted
           whole, from the campaign run's page (§16.4). Nor has a failed run
           whose report is still being written (convention §12.1). A locked
           report keeps the run (convention §7.3.3): Delete stays, disabled,
           and the span takes the pointer a disabled button does not, to say
           why. -->
      <span
        class="ml-auto"
        title={run.report_locked ? 'The report is locked; unlock it to delete this run' : undefined}
      >
        <Button
          variant="destructive"
          disabled={run.report_locked}
          onclick={() => request_delete({ kind: 'job_run', job_id, run_id: run.id })}
        >
          <Trash2Icon />Delete
        </Button>
      </span>
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
