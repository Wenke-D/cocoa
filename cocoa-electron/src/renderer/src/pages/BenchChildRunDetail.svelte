<!--
  A run dispatched by a bench, seen in the bench's context (§19).

  This page and `JobRunDetail` render the same run record — one record, two
  addresses (§2.3.1). The facts come from the same component precisely so they
  cannot drift apart. What this page adds is the context: the trail back to the
  bench run, the call index within the plan, and a link to the job's own
  overview — which is the *only* way from here to move the Explorer's selection
  to that job.
-->
<script lang="ts">
  import { bench_run, is_cancellable, job_run } from '@shared/world'
  import type { Crumb } from '../ui_state'
  import { app, dispatched_owner, entity_of, navigate, request_cancel } from '../state.svelte'
  import Breadcrumbs from '../lib/components/Breadcrumbs.svelte'
  import RunFacts from '../lib/components/RunFacts.svelte'
  import StatusPill from '../lib/components/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'

  let {
    bench_id,
    bench_run_id,
    run_id
  }: { bench_id: string; bench_run_id: string; run_id: string } = $props()

  /** The bench *entity*, for its name; and the bench *run* this was one call of. */
  const bench = $derived(entity_of(bench_id))
  const parent_run = $derived(bench_run(app.world, bench_id, bench_run_id))
  const job_id = $derived(dispatched_owner(bench_id, bench_run_id, run_id))
  const run = $derived(job_id === undefined ? undefined : job_run(app.world, job_id, run_id))
  const step = $derived(parent_run?.plan.steps.find((candidate) => candidate.run_id === run_id))
  const job = $derived(step === undefined ? undefined : entity_of(step.job_id))

  /**
   * The leaf must say which call this is: a plan may dispatch the same job
   * several times, and `Solver GPU` alone is then ambiguous (§19). The
   * parameters are what tell two calls apart, so they lead; the call index
   * settles the case where even those are identical.
   */
  const leaf = $derived.by(() => {
    const name = job?.name ?? '(removed)'
    if (step === undefined) {
      return name
    }
    const parameters = step.parameters === '' ? '' : ` ${step.parameters}`
    return `${name}${parameters} · call ${step.index}`
  })

  const crumbs = $derived<Crumb[]>([
    { label: bench?.name ?? '(removed)', route: { page: 'entity', entity_id: bench_id } },
    {
      label: bench_run_id,
      route: { page: 'bench_run', bench_id, run_id: bench_run_id },
      mono: true
    },
    { label: leaf, route: null }
  ])
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <header>
    <h1 class="mono">{run.id}</h1>
    <StatusPill status={run.status} health={run.query_health} />
    <!--
      Cancelling here stops this one run. It is not the bench's cancel, and it
      does not touch the siblings (§19, §2.3.3) — which is why the target is
      the job run, exactly as it is on the job's own page.
    -->
    {#if is_cancellable(run.status) && step !== undefined}
      <Button
        variant="secondary"
        class="cancel ml-auto"
        onclick={() => request_cancel({ kind: 'job_run', job_id: step.job_id, run_id: run.id })}
      >
        Cancel Run
      </Button>
    {/if}
  </header>

  <RunFacts {run} report_context={{ kind: 'bench_child', bench_id, bench_run_id }}>
    {#snippet leading()}
      <dt>Job</dt>
      <dd>
        {#if step !== undefined}
          <!-- Explicit navigation: arriving through the bench must not move the
               Explorer selection, but asking for the job by name may (§19). -->
          <button
            class="job-link"
            onclick={() => navigate({ page: 'entity', entity_id: step.job_id })}
          >
            {job?.name ?? '(removed)'}
          </button>
        {:else}
          (not in the plan)
        {/if}
      </dd>
      <dt>Call</dt>
      <dd class="mono">{step?.index ?? '—'}</dd>
    {/snippet}
  </RunFacts>
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
