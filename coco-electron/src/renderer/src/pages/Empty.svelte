<!--
  The main region's empty page (§12) — the front door: every launch lands
  here (architecture §32). A centred brand moment: the wordmark sits at the
  optical centre of the region and one line of state hangs beneath it. The
  Explorer still holds the next action — the line points there — but the
  daily open earns a moment of identity first. The wordmark never moves
  between states; only the line under it changes, with no transition.
-->
<script lang="ts">
  import { active_run_count, add_folder, app } from '../state.svelte'
  import { Button } from '$lib/components/ui/button'
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
  <h1 class="wordmark">coco</h1>
  {#if !app.connected}
    <section class="state" role="status" aria-live="polite" aria-busy="true">
      <p class="line">
        <span class="spin" aria-hidden="true">
          <LoaderCircleIcon size={14} strokeWidth={1.75} />
        </span>
        Reading registered experiment folders.
      </p>
    </section>
  {:else if app.world.entities.length === 0}
    <!-- §12: an ordinary absence, never an error. -->
    <section class="state">
      <p class="line">
        No experiments are registered. Add a folder that contains a valid experiment manifest.
      </p>
      <div class="action"><Button onclick={add_folder}>Add Folder</Button></div>
    </section>
  {:else}
    <section class="state">
      <p class="line">Select an experiment in the Explorer to begin.</p>
      <p class="glance" aria-label={glance.replaceAll(' · ', ', ')}>{glance}</p>
    </section>
  {/if}
</div>

<style>
  /* The middle row pins the wordmark at the golden section (~38% down:
     1 / 2.618), so a state's height changes what hangs below, never the
     mark. */
  .empty {
    flex: 1;
    display: grid;
    grid-template-rows: 1fr auto 1.618fr;
    justify-items: center;
  }

  .wordmark {
    grid-row: 2;
    margin: 0;
    font-size: 42px;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--accent);
    user-select: none;
  }

  .state {
    grid-row: 3;
    padding-top: 18px;
    max-width: 460px;
    text-align: center;
  }

  .line {
    margin: 0;
    font-size: 14px;
    line-height: 22px;
    color: var(--description);
  }

  .spin {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 6px;
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

  .action {
    margin-top: 16px;
  }

  .glance {
    margin: 28px 0 0;
    font-size: 12px;
    line-height: 18px;
    color: var(--description);
    font-variant-numeric: tabular-nums;
  }
</style>
