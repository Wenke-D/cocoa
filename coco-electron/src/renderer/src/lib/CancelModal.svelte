<!--
  Cancel confirmation (specification §16). Cancel is destructive, so it always
  asks first, and the copy states exactly what will and will not be touched.
  Port of `src/ui/overlays/cancel_modal.rs`.
-->
<script lang="ts">
  import {
    bench_run,
    format_clock,
    format_duration,
    is_active,
    is_terminal,
    job_run
  } from '@shared/world'
  import { app, close_overlay, confirm_cancel, entity_of } from '../state.svelte'
  import type { Overlay } from '../state.svelte'
  import ModalFrame from './ModalFrame.svelte'

  let { overlay }: { overlay: Overlay & { kind: 'confirm_cancel' } } = $props()

  const copy = $derived.by(() => {
    const target = overlay.target
    if (target.kind === 'job_run') {
      const run = job_run(app.world, target.job_id, target.run_id)
      if (run === undefined) return null
      return {
        title: 'Cancel this Job run?',
        subject: entity_of(target.job_id)?.name ?? '(removed)',
        lines: [
          `Started at ${format_clock(run.started_at)}`,
          `Running for ${format_duration(run.started_at, run.ended_at, app.now_ms)}.`,
          '',
          'The cancellation operation defined by the manifest will be requested.'
        ],
        confirm: 'Cancel Run'
      }
    }
    const run = bench_run(app.world, target.bench_id, target.run_id)
    if (run === undefined) return null
    const children = run.plan.steps
      .map((step) => job_run(app.world, step.job_id, step.run_id))
      .filter((child) => child !== undefined)
    const active = children.filter((child) => is_active(child.status)).length
    const finished = children.filter((child) => is_terminal(child.status)).length
    return {
      title: 'Cancel this Bench run?',
      subject: entity_of(target.bench_id)?.name ?? '(removed)',
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
  <ModalFrame title={copy.title} error={overlay.error} busy={overlay.busy} onclose={close_overlay}>
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
      <button class="secondary" onclick={close_overlay} disabled={overlay.busy}>
        Keep Running
      </button>
      <button class="primary" onclick={confirm_cancel} disabled={overlay.busy}>
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
