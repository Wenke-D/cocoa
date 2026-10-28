<script lang="ts">
  import { is_cancellable, is_terminal } from '@shared/run_status'
  import { display_status, format_duration, format_started_at, trigger_label } from '../format'
  import { tone_color, tone_of } from '../tone'
  import { campaign_run, job_run } from '@shared/world'
  import type { ReportFormat } from '@shared/world'
  import type { Crumb } from '../route'
  import { lock_report, open_attachments, rerun_report, save_report, visualize } from '../commands'
  import { navigate } from '../navigation'
  import { request_cancel, request_delete } from '../overlays.svelte'
  import { app } from '../state.svelte'
  import { entity_name, entity_of } from '../world_queries'
  import Breadcrumbs from '../lib/components/Breadcrumbs.svelte'
  import ReportButtons from '../lib/components/ReportButtons.svelte'
  import RunHeader from '../lib/components/RunHeader.svelte'
  import StatusPill from '../lib/components/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'
  import SquareIcon from '@lucide/svelte/icons/square'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'

  let { campaign_id, run_id }: { campaign_id: string; run_id: string } = $props()

  const run = $derived(campaign_run(app.world, campaign_id, run_id))
  const campaign = $derived(entity_of(campaign_id))

  const crumbs = $derived<Crumb[]>([
    { label: entity_name(campaign), route: { page: 'entity', entity_id: campaign_id } },
    { label: run_id, route: null, mono: true }
  ])

  /** Why Delete is unavailable: a locked report it would take with it, or `null`. */
  const delete_lock = $derived.by(() => {
    if (run === undefined) {
      return null
    }
    if (run.report_locked) {
      return 'The report is locked; unlock it to delete this run'
    }
    const member = run.plan.steps.find(
      (step) => job_run(app.world, step.job_id, step.run_id)?.report_locked === true
    )
    return member === undefined
      ? null
      : `The report of member run ${member.run_id} is locked; unlock it to delete this run`
  })

  const finished = $derived.by(() => {
    if (run === undefined) {
      return 0
    }
    return run.plan.steps.filter((step) => {
      const child = job_run(app.world, step.job_id, step.run_id)
      return child !== undefined && is_terminal(child.status)
    }).length
  })

  /** One segment per call, in plan order, in its status's colour; a call not listed is grey. */
  const segments = $derived(
    (run?.plan.steps ?? []).map((step) => {
      const child = job_run(app.world, step.job_id, step.run_id)
      if (child === undefined) {
        return { index: step.index, label: 'not listed', color: tone_color('neutral') }
      }
      const label = display_status(child.status, child.query_health)
      return {
        index: step.index,
        label,
        color: tone_color(label === 'Unknown' ? 'warn' : tone_of(child.status))
      }
    })
  )
</script>

{#if run !== undefined}
  <Breadcrumbs {crumbs} />

  <RunHeader kind="Campaign run" id={run.id} status={run.status} health={run.query_health}>
    {#snippet meta()}
      <span class="progress">{finished} / {run.plan.steps.length} finished</span>
    {/snippet}
    {#snippet actions()}
      {#if is_cancellable(run.status)}
        <Button
          variant="secondary"
          class="cancel"
          onclick={() => request_cancel({ kind: 'campaign_run', campaign_id, run_id: run.id })}
        >
          <SquareIcon />Cancel Campaign
        </Button>
      {:else if is_terminal(run.status)}
        <!-- Deleting takes the members with it, so any locked report among
             them keeps it, the campaign's own included (convention §7.3.3);
             the span takes the pointer a disabled button does not, to say why. -->
        <span title={delete_lock ?? undefined}>
          <Button
            variant="destructive"
            disabled={delete_lock !== null}
            onclick={() => request_delete({ kind: 'campaign_run', campaign_id, run_id: run.id })}
          >
            <Trash2Icon />Delete
          </Button>
        </span>
      {/if}
    {/snippet}
  </RunHeader>

  <dl class="facts panel">
    <div class="fact">
      <dt>Started by</dt>
      <dd>{trigger_label(run.by)}</dd>
    </div>
    <div class="fact">
      <dt>Started at</dt>
      <dd>{format_started_at(run.started_at)}</dd>
    </div>
    <div class="fact">
      <dt>Duration</dt>
      <dd class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</dd>
    </div>
    <div class="fact">
      <dt>Arguments</dt>
      <dd><span class="mono params">{run.parameters === '' ? '(none)' : run.parameters}</span></dd>
    </div>
    <div class="fact">
      <dt>Report</dt>
      <dd>
        <ReportButtons
          report={run.report}
          open={(format: ReportFormat) =>
            navigate({
              page: 'report',
              context: { kind: 'campaign_run', campaign_id },
              run_id: run.id,
              format
            })}
          attachments={run.attachments}
          open_attachments={() => open_attachments({ entity_id: campaign_id, run_id: run.id })}
          visualize={run.visualizable
            ? () => visualize({ entity_id: campaign_id, run_id: run.id })
            : null}
          save={typeof run.report === 'object' && 'Available' in run.report
            ? () => save_report({ entity_id: campaign_id, run_id: run.id })
            : null}
          lock={(typeof run.report === 'object' && 'Available' in run.report) || run.report_locked
            ? {
                locked: run.report_locked,
                toggle: () =>
                  lock_report({
                    entity_id: campaign_id,
                    run_id: run.id,
                    locked: !run.report_locked
                  })
              }
            : null}
          rerun={run.report_rerunnable
            ? () => rerun_report({ entity_id: campaign_id, run_id: run.id })
            : null}
        />
      </dd>
    </div>
    {#if run.error !== null}
      <div class="fact">
        <dt>Error</dt>
        <dd class="error">{run.error}</dd>
      </div>
    {/if}
  </dl>

  <h2 class="section-title">
    Dispatched calls <span class="tally">{run.plan.steps.length}</span>
  </h2>
  <!-- The plan at a glance: one segment per call, in its status's colour,
       so a fan-out half-finished or one call failed is seen before a row is
       read. The table below says the same thing in words. -->
  {#if segments.length > 0}
    <div class="segments" role="img" aria-label="{finished} of {segments.length} calls finished">
      {#each segments as segment (segment.index)}
        <span
          class="segment"
          style="background: {segment.color}"
          title="Call {segment.index}: {segment.label}"
        ></span>
      {/each}
    </div>
  {/if}
  <div class="panel">
    <table class="runs">
      <!-- Parameters last, and the remainder: it is the column whose content has
           no bound — a sweep is what varies it — so it gets the leftover width,
           and the leftover width belongs to the last column (§22.2). -->
      <colgroup>
        <col style="width: 68px" />
        <col style="width: 180px" />
        <col style="width: 124px" />
        <col />
      </colgroup>
      <thead>
        <tr
          ><th class="num">#</th><th>Job</th><th>Status</th><th class="over-params">Arguments</th
          ></tr
        >
      </thead>
      <tbody>
        {#each run.plan.steps as step (step.index)}
          {@const child = job_run(app.world, step.job_id, step.run_id)}
          {@const job_name = entity_name(entity_of(step.job_id))}
          <!-- The campaign's context, not the job's: same run, other address
               (§2.3.1), and the Explorer stays on the campaign (§19). -->
          <tr
            onclick={() =>
              navigate({
                page: 'campaign_child',
                campaign_id,
                campaign_run_id: run.id,
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
  </div>
{/if}

<style>
  .progress {
    color: var(--description);
    font-variant-numeric: tabular-nums;
  }

  .error {
    color: var(--error);
    user-select: text;
  }

  .segments {
    display: flex;
    gap: 3px;
    height: 6px;
    margin-bottom: 10px;
  }

  .segment {
    flex: 1;
    border-radius: 3px;
  }

  .missing {
    color: var(--description);
    font-style: italic;
  }
</style>
