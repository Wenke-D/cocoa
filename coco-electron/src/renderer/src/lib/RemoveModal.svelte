<!--
  Remove-from-Explorer confirmation. The wording is the specification's
  (§36: `Remove from Explorer`, never `Delete Folder`), and the copy says what
  survives — because what makes this safe is that nothing on disk is touched.
-->
<script lang="ts">
  import { benchRun, isActive, jobRun } from '@shared/world'
  import { app, closeOverlay, confirmRemove, entityOf } from '../state.svelte'
  import type { Overlay } from '../state.svelte'
  import ModalFrame from './ModalFrame.svelte'

  let { overlay }: { overlay: Overlay & { kind: 'confirmRemove' } } = $props()

  const entity = $derived(entityOf(overlay.entityId))

  /** Runs coco would stop watching. They keep running on the cluster. */
  const activeRuns = $derived.by(() => {
    if (entity === undefined) return 0
    const world = app.world
    const ids =
      entity.kind === 'Job'
        ? (world.runs_by_job[entity.id] ?? [])
        : (world.runs_by_bench[entity.id] ?? [])
    return ids.filter((id) => {
      const run =
        entity.kind === 'Job' ? jobRun(world, entity.id, id) : benchRun(world, entity.id, id)
      return run !== undefined && isActive(run.status)
    }).length
  })
</script>

{#if entity !== undefined}
  <ModalFrame
    title="Remove this experiment from the Explorer?"
    error={overlay.error}
    busy={overlay.busy}
    onclose={closeOverlay}
  >
    {#snippet body()}
      <p class="subject">{entity.name}</p>
      <p class="path mono">{entity.path}</p>
      <p class="gap"></p>
      <p>
        The folder is left exactly as it is — its manifest, its runs and its reports all stay on
        disk. Adding it again brings the history back.
      </p>
      {#if activeRuns > 0}
        <p class="gap"></p>
        <p class="warning">
          {activeRuns === 1 ? '1 run is' : `${activeRuns} runs are`} still active. They keep running;
          coco just stops watching them.
        </p>
      {/if}
    {/snippet}
    {#snippet actions()}
      <button class="secondary" onclick={closeOverlay} disabled={overlay.busy}>Keep</button>
      <button class="primary" onclick={confirmRemove} disabled={overlay.busy}>
        {overlay.busy ? 'Removing…' : 'Remove from Explorer'}
      </button>
    {/snippet}
  </ModalFrame>
{/if}

<style>
  .subject {
    color: var(--strong-foreground);
    font-weight: 600;
  }

  .path {
    color: var(--description);
    user-select: text;
    word-break: break-all;
  }

  p {
    margin: 0 0 4px;
    line-height: 1.5;
  }

  .gap {
    height: 10px;
  }

  .warning {
    color: var(--warning);
  }
</style>
