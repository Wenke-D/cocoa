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
  import { isCancellable } from '@shared/world'
  import type { Crumb } from '@shared/ui'
  import { app, entityOf, navigate, requestCancel } from '../state.svelte'
  import Breadcrumbs from '../lib/Breadcrumbs.svelte'
  import RunFacts from '../lib/RunFacts.svelte'
  import StatusPill from '../lib/StatusPill.svelte'

  let {
    benchId,
    benchRunId,
    runId
  }: { benchId: string; benchRunId: string; runId: string } = $props()

  const benchRun = $derived(app.world.bench_runs[benchRunId])
  const bench = $derived(entityOf(benchId))
  const run = $derived(app.world.job_runs[runId])
  const step = $derived(benchRun?.plan.steps.find((candidate) => candidate.run_id === runId))
  const job = $derived(step === undefined ? undefined : entityOf(step.job_id))

  /**
   * The leaf must say which call this is: a plan may dispatch the same job
   * several times, and `Solver GPU` alone is then ambiguous (§19). The
   * parameters are what tell two calls apart, so they lead; the call index
   * settles the case where even those are identical.
   */
  const leaf = $derived.by(() => {
    const name = job?.name ?? '(removed)'
    if (step === undefined) return name
    const parameters = step.parameters === '' ? '' : ` ${step.parameters}`
    return `${name}${parameters} · call ${step.index}`
  })

  const crumbs = $derived<Crumb[]>([
    { label: bench?.name ?? '(removed)', route: { page: 'entity', entityId: benchId } },
    { label: benchRunId, route: { page: 'benchRun', benchId, runId: benchRunId }, mono: true },
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
    {#if isCancellable(run.status) && step !== undefined}
      <button
        class="cancel secondary"
        onclick={() => requestCancel({ kind: 'jobRun', jobId: step.job_id, runId: run.id })}
      >
        Cancel Run
      </button>
    {/if}
  </header>

  <RunFacts {run} reportContext={{ kind: 'benchChild', benchId, benchRunId }}>
    {#snippet leading()}
      <dt>Job</dt>
      <dd>
        {#if step !== undefined}
          <!-- Explicit navigation: arriving through the bench must not move the
               Explorer selection, but asking for the job by name may (§19). -->
          <button class="job-link" onclick={() => navigate({ page: 'entity', entityId: step.job_id })}>
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
