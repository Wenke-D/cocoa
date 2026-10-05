<script lang="ts">
  import {
    format_duration,
    format_started_at,
    is_cancellable,
    is_terminal,
    trigger_label
  } from '@shared/world'
  import { bench_run, job_run } from '@shared/world'
  import type { ReportFormat } from '@shared/world'
  import type { Crumb } from '../ui_state'
  import { app, entity_of, navigate, request_cancel, request_delete } from '../state.svelte'
  import Breadcrumbs from '../lib/components/Breadcrumbs.svelte'
  import ReportButtons from '../lib/components/ReportButtons.svelte'
  import StatusPill from '../lib/components/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'
  import SquareIcon from '@lucide/svelte/icons/square'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'

  let { bench_id, run_id }: { bench_id: string; run_id: string } = $props()

  const run = $derived(bench_run(app.world, bench_id, run_id))
  const bench = $derived(entity_of(bench_id))

  const crumbs = $derived<Crumb[]>([
    { label: bench?.name ?? '(removed)', route: { page: 'entity', entity_id: bench_id } },
    { label: run_id, route: null, mono: true }
  ])

  const finished = $derived.by(() => {
    if (run === undefined) {
      return 0
    }
    return run.plan.steps.filter((step) => {
      const child = job_run(app.world, step.job_id, step.run_id)
      return child !== undefined && is_terminal(child.status)
    }).length
  })
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <header>
    <h1 class="mono">{run.id}</h1>
    <StatusPill status={run.status} health={run.query_health} />
    <span class="progress">{finished} / {run.plan.steps.length} finished</span>
    {#if is_cancellable(run.status)}
      <Button
        size="icon-sm"
        variant="secondary"
        class="cancel ml-auto"
        title="Cancel Bench"
        aria-label="Cancel Bench"
        onclick={() => request_cancel({ kind: 'bench_run', bench_id, run_id: run.id })}
      >
        <SquareIcon />
      </Button>
    {:else if is_terminal(run.status)}
      <Button
        size="icon-sm"
        variant="destructive"
        class="ml-auto"
        title="Delete Run…"
        aria-label="Delete Run"
        onclick={() => request_delete({ kind: 'bench_run', bench_id, run_id: run.id })}
      >
        <Trash2Icon />
      </Button>
    {/if}
  </header>

  <dl>
    <dt>Started by</dt>
    <dd>{trigger_label(run.by)}</dd>
    <dt>Started at</dt>
    <dd>{format_started_at(run.started_at)}</dd>
    <dt>Duration</dt>
    <dd class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</dd>
    <dt>Arguments</dt>
    <dd class="mono params">{run.parameters === '' ? '(none)' : run.parameters}</dd>
    <dt>Report</dt>
    <dd>
      <ReportButtons
        report={run.report}
        open={(format: ReportFormat) =>
          navigate({
            page: 'report',
            context: { kind: 'bench_run', bench_id },
            run_id: run.id,
            format
          })}
      />
    </dd>
    {#if run.error !== null}
      <dt>Error</dt>
      <dd class="error">{run.error}</dd>
    {/if}
  </dl>

  <h2>Dispatched calls</h2>
  <table class="runs">
    <!-- Parameters last, and the remainder: it is the column whose content has
         no bound — a sweep is what varies it — so it gets the leftover width,
         and the leftover width belongs to the last column (§22.2). -->
    <colgroup>
      <col style="width: 54px" />
      <col style="width: 180px" />
      <col style="width: 116px" />
      <col />
    </colgroup>
    <thead>
      <tr
        ><th class="num">#</th><th>Job</th><th>Status</th><th class="over-params">Arguments</th></tr
      >
    </thead>
    <tbody>
      {#each run.plan.steps as step (step.index)}
        {@const child = job_run(app.world, step.job_id, step.run_id)}
        {@const job_name = entity_of(step.job_id)?.name ?? '(removed)'}
        <!-- The bench's context, not the job's: same run, other address
             (§2.3.1), and the Explorer stays on the bench (§19). -->
        <tr
          onclick={() =>
            navigate({
              page: 'bench_child',
              bench_id,
              bench_run_id: run.id,
              run_id: step.run_id
            })}
        >
          <td class="num">{step.index}</td>
          <td title={job_name}>{job_name}</td>
          <td>
            {#if child !== undefined}
              <StatusPill status={child.status} health={child.query_health} />
            {:else}
              <span class="missing">not listed</span>
            {/if}
          </td>
          <td title={step.parameters}>
            {#if step.parameters !== ''}<span class="mono params">{step.parameters}</span>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
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

  .progress {
    color: var(--description);
  }

  dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    max-width: 640px;
  }

  dt {
    color: var(--description);
  }

  dd {
    margin: 0;
  }

  .error {
    color: var(--error);
    user-select: text;
  }

  h2 {
    margin: 24px 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .missing {
    color: var(--description);
    font-style: italic;
  }
</style>
