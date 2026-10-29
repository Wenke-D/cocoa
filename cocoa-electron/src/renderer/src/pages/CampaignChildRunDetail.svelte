<!--
  A run dispatched by a campaign, seen in the campaign's context (§19).

  This page and `JobRunDetail` render the same run record — one record, two
  addresses (§2.3.1). The facts come from the same component precisely so they
  cannot drift apart. What this page adds is the context: the trail back to the
  campaign run, the call index within the plan, and a link to the job's own
  overview — which is the *only* way from here to move the Explorer's selection
  to that job.
-->
<script lang="ts">
  import { is_cancellable } from '@shared/run_status'
  import { job_run } from '@shared/world'
  import type { Crumb } from '../route'
  import { navigate } from '../navigation'
  import { request_cancel } from '../overlays.svelte'
  import { app } from '../state.svelte'
  import { call_of, entity_name, entity_of } from '../world_queries'
  import Breadcrumbs from '../lib/components/Breadcrumbs.svelte'
  import RunFacts from '../lib/components/RunFacts.svelte'
  import RunHeader from '../lib/components/RunHeader.svelte'
  import { Button } from '$lib/components/ui/button'
  import SquareIcon from '@lucide/svelte/icons/square'

  let {
    campaign_id,
    campaign_run_id,
    job_id,
    run_id
  }: { campaign_id: string; campaign_run_id: string; job_id: string; run_id: string } = $props()

  /** The campaign *entity*, for its name; the call is found in its run's plan. */
  const campaign = $derived(entity_of(campaign_id))
  const run = $derived(job_run(app.world, job_id, run_id))
  const step = $derived(call_of(campaign_id, campaign_run_id, job_id, run_id))
  /** Every run of this call, oldest first, when it was run again (convention §8.5). */
  const attempts = $derived(
    step === undefined || step.attempts.length === 0 ? [] : [...step.attempts, step.run_id]
  )
  const job = $derived(step === undefined ? undefined : entity_of(step.job_id))

  /**
   * The leaf must say which call this is: a plan may dispatch the same job
   * several times, and `Solver GPU` alone is then ambiguous (§19). The
   * parameters are what tell two calls apart, so they lead; the call index
   * settles the case where even those are identical.
   */
  const leaf = $derived.by(() => {
    const name = entity_name(job)
    if (step === undefined) {
      return name
    }
    const parameters = step.parameters === '' ? '' : ` ${step.parameters}`
    return `${name}${parameters} · call ${step.index}`
  })

  const crumbs = $derived<Crumb[]>([
    { label: entity_name(campaign), route: { page: 'entity', entity_id: campaign_id } },
    {
      label: campaign_run_id,
      route: { page: 'campaign_run', campaign_id, run_id: campaign_run_id },
      mono: true
    },
    { label: leaf, route: null }
  ])
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <RunHeader
    kind="Job run · campaign call"
    id={run.id}
    status={run.status}
    health={run.query_health}
  >
    {#snippet actions()}
      <!--
        Cancelling here stops this one run. It is not the campaign's cancel, and it
        does not touch the siblings (§19, §2.3.3) — which is why the target is
        the job run, exactly as it is on the job's own page.
      -->
      {#if is_cancellable(run.status) && step !== undefined}
        <Button
          variant="secondary"
          class="cancel"
          onclick={() => request_cancel({ kind: 'job_run', job_id: step.job_id, run_id: run.id })}
        >
          <SquareIcon />Cancel Run
        </Button>
      {/if}
    {/snippet}
  </RunHeader>

  <RunFacts {run} report_context={{ kind: 'campaign_child', campaign_id, campaign_run_id, job_id }}>
    {#snippet leading()}
      <div class="fact">
        <dt>Job</dt>
        <dd>
          {#if step !== undefined}
            <!-- Explicit navigation: arriving through the campaign must not move the
                 Explorer selection, but asking for the job by name may (§19). -->
            <button
              class="job-link"
              onclick={() => navigate({ page: 'entity', entity_id: step.job_id })}
            >
              {entity_name(job)}
            </button>
          {:else}
            (not in the plan)
          {/if}
        </dd>
      </div>
      <div class="fact">
        <dt>Call</dt>
        <dd class="mono">{step?.index ?? '—'}</dd>
      </div>
      {#if attempts.length > 0}
        <div class="fact">
          <dt>Attempts</dt>
          <dd class="attempts">
            {#each attempts as attempt, position (attempt)}
              {#if position > 0}<span class="then">→</span>{/if}
              {#if attempt === run_id}
                <strong class="mono">{attempt}</strong>
              {:else}
                <button
                  class="job-link mono"
                  onclick={() =>
                    navigate({
                      page: 'campaign_child',
                      campaign_id,
                      campaign_run_id,
                      job_id,
                      run_id: attempt
                    })}
                >
                  {attempt}
                </button>
              {/if}
            {/each}
          </dd>
        </div>
      {/if}
    {/snippet}
  </RunFacts>
{/if}

<style>
  .attempts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .then {
    color: var(--description);
  }
</style>
