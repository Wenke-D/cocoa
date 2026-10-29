<!--
  Regenerating a campaign's reports, members first (§16.5). It re-runs a
  report script for every run of the fan-out, so it asks, counting what it
  replaces. The confirm is the primary colour: a regenerate replaces files
  the scripts will write again, and nothing is destroyed for good.
-->
<script lang="ts">
  import { campaign_run } from '@shared/world'
  import { close_overlay, confirm_regenerate } from '../../overlays.svelte'
  import { app } from '../../state.svelte'
  import { entity_name, entity_of } from '../../world_queries'
  import type { Overlay } from '../../overlays.svelte'
  import ModalFrame from './ModalFrame.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'

  let { overlay }: { overlay: Overlay & { kind: 'confirm_regenerate' } } = $props()

  const run = $derived(campaign_run(app.world, overlay.target.campaign_id, overlay.target.run_id))
  const members = $derived(run?.plan.steps.length ?? 0)
</script>

{#if run !== undefined}
  <ModalFrame
    title={members === 1
      ? "Regenerate the member's report, then the campaign's?"
      : `Regenerate ${members} member reports, then the campaign's?`}
    error={overlay.error}
    busy={overlay.busy}
    onclose={close_overlay}
  >
    {#snippet body()}
      <p class="subject">{entity_name(entity_of(overlay.target.campaign_id))}</p>
      <p>Each member's report script runs again, then the campaign's.</p>
      <p>Every report is replaced by its script's new output.</p>
      <p>A member report that fails stops it there; the campaign's report is then left as it is.</p>
    {/snippet}
    {#snippet actions()}
      <Button variant="secondary" disabled={overlay.busy} onclick={close_overlay}>Keep them</Button>
      <Button class="confirm" disabled={overlay.busy} onclick={confirm_regenerate}>
        {#if overlay.busy}<Spinner />Regenerating…{:else}Regenerate All{/if}
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
</style>
