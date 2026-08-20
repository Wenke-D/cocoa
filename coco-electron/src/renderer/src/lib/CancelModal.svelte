<!--
  Cancel confirmation (specification §16). Cancel is destructive, so it always
  asks first, and the copy states exactly what will and will not be touched.
  Port of `src/ui/overlays/cancel_modal.rs`.
-->
<script lang="ts">
  import { formatClock, formatDuration, isActive, isTerminal } from '@shared/world'
  import { app, closeOverlay, confirmCancel, entityOf } from '../state.svelte'
  import type { Overlay } from '../state.svelte'
  import ModalFrame from './ModalFrame.svelte'

  let { overlay }: { overlay: Overlay & { kind: 'confirmCancel' } } = $props()

  const copy = $derived.by(() => {
    const target = overlay.target
    if (target.kind === 'jobRun') {
      const run = app.world.job_runs[target.runId]
      if (run === undefined) return null
      return {
        title: 'Cancel this Job run?',
        subject: entityOf(target.jobId)?.name ?? '(removed)',
        lines: [
          `Started at ${formatClock(run.started_at)}`,
          `Running for ${formatDuration(run.started_at, run.ended_at, app.nowMs)}.`,
          '',
          'The cancellation operation defined by the manifest will be requested.'
        ],
        confirm: 'Cancel Run'
      }
    }
    const run = app.world.bench_runs[target.runId]
    if (run === undefined) return null
    const children = run.plan.steps
      .map((step) => app.world.job_runs[step.run_id])
      .filter((child) => child !== undefined)
    const active = children.filter((child) => isActive(child.status)).length
    const finished = children.filter((child) => isTerminal(child.status)).length
    return {
      title: 'Cancel this Bench run?',
      subject: entityOf(target.benchId)?.name ?? '(removed)',
      lines: [
        `All ${active} runs still active will be cancelled.`,
        `${finished} runs have already finished and keep their results.`,
        '',
        'Runs of the same Jobs started outside this Bench are not affected.'
      ],
      confirm: 'Cancel Bench'
    }
  })
</script>

{#if copy !== null}
  <ModalFrame title={copy.title} error={overlay.error} busy={overlay.busy} onclose={closeOverlay}>
    {#snippet body()}
      <p class="subject">{copy.subject}</p>
      {#each copy.lines as line, index (index)}
        {#if line === ''}
          <p class="gap"></p>
        {:else}
          <p>{line}</p>
        {/if}
      {/each}
    {/snippet}
    {#snippet actions()}
      <button class="secondary" onclick={closeOverlay} disabled={overlay.busy}>
        Keep Running
      </button>
      <button class="primary" onclick={confirmCancel} disabled={overlay.busy}>
        {overlay.busy ? 'Cancelling…' : copy.confirm}
      </button>
    {/snippet}
  </ModalFrame>
{/if}

<style>
  .subject {
    color: var(--strong-foreground);
    font-weight: 600;
  }

  p {
    margin: 0 0 4px;
  }

  .gap {
    height: 10px;
  }
</style>
