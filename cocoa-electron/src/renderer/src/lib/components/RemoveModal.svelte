<!--
  Remove-from-Explorer confirmation. The wording is the specification's
  (§36: `Remove from Explorer`, never `Delete Folder`), and the copy says what
  survives — because what makes this safe is that nothing on disk is touched.
-->
<script lang="ts">
  import { bench_run, is_active, job_run } from '@shared/world'
  import { app, close_overlay, confirm_remove, entity_of } from '../../state.svelte'
  import type { Overlay } from '../../state.svelte'
  import ModalFrame from './ModalFrame.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'

  let { overlay }: { overlay: Overlay & { kind: 'confirm_remove' } } = $props()

  const entity = $derived(entity_of(overlay.entity_id))

  /** Runs cocoa would stop watching. They keep running on the cluster. */
  const active_runs = $derived.by(() => {
    if (entity === undefined) {
      return 0
    }
    const world = app.world
    const ids =
      entity.kind === 'Job'
        ? (world.runs_by_job[entity.id] ?? [])
        : (world.runs_by_bench[entity.id] ?? [])
    return ids.filter((id) => {
      const run =
        entity.kind === 'Job' ? job_run(world, entity.id, id) : bench_run(world, entity.id, id)
      return run !== undefined && is_active(run.status)
    }).length
  })
</script>

{#if entity !== undefined}
  <ModalFrame
    title="Remove this experiment from the Explorer?"
    error={overlay.error}
    busy={overlay.busy}
    onclose={close_overlay}
  >
    {#snippet body()}
      <p class="subject">{entity.name}</p>
      <p class="path mono">{entity.path}</p>
      <p class="gap"></p>
      <p>
        The folder is left exactly as it is — its manifest, its runs and its reports all stay on
        disk. Adding it again brings the history back.
      </p>
      {#if active_runs > 0}
        <p class="gap"></p>
        <p class="warning">
          {active_runs === 1 ? '1 run is' : `${active_runs} runs are`} still active. They keep running;
          cocoa just stops watching them.
        </p>
      {/if}
    {/snippet}
    {#snippet actions()}
      <Button variant="secondary" onclick={close_overlay} disabled={overlay.busy}>Keep</Button>
      <Button class="confirm" onclick={confirm_remove} disabled={overlay.busy}>
        {#if overlay.busy}<Spinner />Removing…{:else}Remove from Explorer{/if}
      </Button>
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
