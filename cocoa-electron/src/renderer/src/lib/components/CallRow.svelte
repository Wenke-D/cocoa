<!--
  One call of a campaign run's dispatch table (§18.3): the cells are the
  page's; this is the row's behaviour. A click opens the call's run in the
  campaign's context (§19). A right-click offers the history's two actions
  (§22.6) for a call that did not succeed, each starting a run of the call's
  job that takes the call's place (convention §8.5): Start over runs the
  call's values now, Refill puts them in the job's Start page, as far as the
  job's parameters as they are now allow. Elsewhere both are disabled, and
  the menu's first line says why.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { is_terminal } from '@shared/run_status'
  import type { CampaignPlanStep, JobRun } from '@shared/world'
  import { navigate } from '../../navigation'
  import { prefill_start, start_again } from '../../prefill.svelte'
  import * as ContextMenu from '$lib/components/ui/context-menu'

  let {
    campaign_id,
    campaign_run_id,
    step,
    run,
    report_locked,
    children
  }: {
    campaign_id: string
    campaign_run_id: string
    step: CampaignPlanStep
    /** The call's current run; `undefined` when the world does not list it. */
    run: JobRun | undefined
    /** The campaign's own report is locked: a new run would have it regenerated. */
    report_locked: boolean
    children: Snippet
  } = $props()

  const replaces = $derived({ campaign_id, campaign_run_id, run_id: step.run_id })

  /** Why the call cannot be run again now, or `null`. */
  const blocked = $derived(
    run === undefined
      ? "The call's run is not listed"
      : !is_terminal(run.status)
        ? `Run ${run.id} is still ${run.status.toLowerCase()}`
        : run.status === 'Succeeded'
          ? `Run ${run.id} succeeded; only a call that did not succeed is run again`
          : report_locked
            ? "The campaign's report is locked; unlock it to run a call again"
            : null
  )
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      <tr
        {...props}
        onclick={() =>
          navigate({
            page: 'campaign_child',
            campaign_id,
            campaign_run_id,
            job_id: step.job_id,
            run_id: step.run_id
          })}>{@render children()}</tr
      >
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Content class="max-w-72">
    {#if blocked !== null}
      <ContextMenu.Label class="font-normal">{blocked}</ContextMenu.Label>
      <ContextMenu.Separator />
    {/if}
    <ContextMenu.Item
      disabled={blocked !== null}
      onSelect={() => void start_again(step.job_id, run?.params ?? {}, replaces)}
    >
      Start over
    </ContextMenu.Item>
    <ContextMenu.Item
      disabled={blocked !== null}
      onSelect={() => prefill_start(step.job_id, step.run_id, run?.params ?? {}, replaces)}
    >
      Refill
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
