<!--
  The main region's empty page (§12) — the front door: every launch lands
  here (architecture §32). A small, left-anchored note, not a centred card:
  the Explorer is where the next action is, and this page acknowledges the
  state without pulling the eye from it. All three states share one
  position, icon slot and baseline, so a change replaces words without
  moving anything — calm at the thousandth launch.
-->
<script lang="ts">
  import { active_run_count, add_folder, app } from '../state.svelte'
  import { Button } from '$lib/components/ui/button'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import ListTreeIcon from '@lucide/svelte/icons/list-tree'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'

  const benches = $derived(app.world.entities.filter((entity) => entity.kind === 'Bench').length)
  const jobs = $derived(app.world.entities.filter((entity) => entity.kind === 'Job').length)
  const active = $derived(active_run_count())

  const counted = (count: number, one: string, many: string): string =>
    `${count} ${count === 1 ? one : many}`

  /** Zero-value segments stay: the line keeps one shape from launch to launch. */
  const glance = $derived(
    [
      counted(benches, 'bench', 'benches'),
      counted(jobs, 'job', 'jobs'),
      counted(active, 'active run', 'active runs')
    ].join(' · ')
  )
</script>

<div class="empty">
  {#if !app.connected}
    <section class="note" role="status" aria-live="polite" aria-busy="true">
      <span class="icon spin" aria-hidden="true">
        <LoaderCircleIcon size={18} strokeWidth={1.5} />
      </span>
      <div>
        <h2>Starting coco</h2>
        <p class="transient">Reading registered experiment folders.</p>
      </div>
    </section>
  {:else if app.world.entities.length === 0}
    <!-- §12: an ordinary absence, never an error. -->
    <section class="note">
      <span class="icon" aria-hidden="true"><FolderIcon size={18} strokeWidth={1.5} /></span>
      <div>
        <h2>No experiments are registered</h2>
        <p>Add a folder that contains a valid experiment manifest.</p>
        <div class="action"><Button onclick={add_folder}>Add Folder</Button></div>
      </div>
    </section>
  {:else}
    <section class="note">
      <span class="icon" aria-hidden="true"><ListTreeIcon size={18} strokeWidth={1.5} /></span>
      <div>
        <h2>Experiments</h2>
        <p>Select a bench or job in the Explorer to view its runs and reports.</p>
        <p class="glance" aria-label={glance.replaceAll(' · ', ', ')}>{glance}</p>
      </div>
    </section>
  {/if}
</div>

<style>
  /* The shell's `.page` wrapper already pads 20px; this tops it up to the
     design's 88px top and 56px left. */
  .empty {
    padding: 68px 36px 28px;
  }

  .note {
    display: grid;
    grid-template-columns: 20px minmax(0, 400px);
    column-gap: 12px;
    max-width: 432px;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-top: 3px;
    color: var(--description);
  }

  .spin {
    animation: turn 1600ms linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  h2 {
    margin: 0;
    font-size: 17px;
    line-height: 24px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  p {
    margin: 4px 0 0;
    max-width: 390px;
    font-size: 13px;
    line-height: 20px;
    color: var(--foreground);
  }

  /* Transient system information, quieter than content. */
  .transient {
    color: var(--description);
  }

  .action {
    margin-top: 16px;
  }

  .glance {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    max-width: 320px;
    font-size: 12px;
    line-height: 18px;
    color: var(--description);
    font-variant-numeric: tabular-nums;
  }
</style>
