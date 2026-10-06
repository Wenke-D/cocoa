<!--
  Delete confirmation (§16.4). Deletion is the one operation that cannot be
  taken back — cancel stops work, remove forgets a folder, this destroys the
  record — so the copy lists exactly what will be removed from disk, and the
  confirm wears the destructive colour.
-->
<script lang="ts">
  import { campaign_run, job_run } from '@shared/world'
  import { app, close_overlay, confirm_delete, entity_of } from '../../state.svelte'
  import type { Overlay } from '../../state.svelte'
  import ModalFrame from './ModalFrame.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'

  let { overlay }: { overlay: Overlay & { kind: 'confirm_delete' } } = $props()

  const copy = $derived.by(() => {
    const target = overlay.target
    if (target.kind === 'job_run') {
      const run = job_run(app.world, target.job_id, target.run_id)
      if (run === undefined) {
        return null
      }
      return {
        title: `Delete run ${run.id} for good?`,
        subject: entity_of(target.job_id)?.name ?? '(removed)',
        lines: [
          'It disappears from the history forever, and its report goes with it.',
          'This cannot be undone.'
        ]
      }
    }
    const run = campaign_run(app.world, target.campaign_id, target.run_id)
    if (run === undefined) {
      return null
    }
    return {
      title: `Delete campaign run ${run.id} for good?`,
      subject: entity_of(target.campaign_id)?.name ?? '(removed)',
      lines: [
        `This campaign run and the ${run.plan.steps.length} runs it dispatched disappear`,
        'from their histories forever, reports included.',
        'This cannot be undone.'
      ]
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
      <Button variant="secondary" disabled={overlay.busy} onclick={close_overlay}>Keep it</Button>
      <Button
        variant="destructive"
        class="confirm"
        disabled={overlay.busy}
        onclick={confirm_delete}
      >
        {#if overlay.busy}<Spinner />Deleting…{:else}Delete{/if}
      </Button>
    {/snippet}
  </ModalFrame>
{/if}

<style>
  .subject {
    font-weight: 600;
    color: var(--strong-foreground);
  }

  p {
    margin: 0 0 6px;
  }

  .gap {
    height: 4px;
  }
</style>
