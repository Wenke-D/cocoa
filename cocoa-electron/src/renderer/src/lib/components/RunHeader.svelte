<!--
  The head of every run page — a job run, a campaign run, a dispatched call
  (§17, §18, §19): a tile in the status's colour carrying its sign, the kind
  of run above its id, the status chip beside it, and the page's one action
  at the right. The tile is what the page is read by from across the room;
  the chip is what it says.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { display_status } from '../../format'
  import { tone_color, tone_of } from '../../tone'
  import type { Tone } from '../../tone'
  import type { QueryHealth, RunStatus } from '@shared/world'
  import StatusPill from './StatusPill.svelte'
  import BanIcon from '@lucide/svelte/icons/ban'
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
  import CircleXIcon from '@lucide/svelte/icons/circle-x'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'

  let {
    kind,
    id,
    status,
    health,
    meta,
    actions
  }: {
    /** What sort of run this is, said over the id: `Job run`, `Campaign run`. */
    kind: string
    id: string
    status: RunStatus
    health: QueryHealth
    /** Said after the chip, on the same line: a campaign's progress. */
    meta?: Snippet
    actions?: Snippet
  } = $props()

  const tone = $derived<Tone>(
    display_status(status, health) === 'Unknown' ? 'warn' : tone_of(status)
  )

  const icons = {
    good: CircleCheckIcon,
    bad: CircleXIcon,
    warn: TriangleAlertIcon,
    neutral: BanIcon,
    info: LoaderCircleIcon
  }
  const Icon = $derived(icons[tone])
</script>

<header style="--tone: {tone_color(tone)}">
  <span class="tile" aria-hidden="true">
    <Icon class={tone === 'info' ? 'spin' : undefined} strokeWidth={2} />
  </span>
  <div class="identity">
    <span class="eyebrow">{kind}</span>
    <div class="line">
      <h1 class="mono">{id}</h1>
      <StatusPill {status} {health} />
      {@render meta?.()}
    </div>
  </div>
  {#if actions !== undefined}
    <div class="actions">{@render actions()}</div>
  {/if}
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
  }

  .tile {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--tone) 15%, transparent);
    color: var(--tone);
  }

  .tile :global(svg) {
    width: 24px;
    height: 24px;
  }

  .tile :global(.spin) {
    animation: turn 2s linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tile :global(.spin) {
      animation: none;
    }
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    line-height: 1.15;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
</style>
