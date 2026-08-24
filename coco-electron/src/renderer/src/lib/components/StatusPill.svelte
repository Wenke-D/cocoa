<!--
  A run's status as a coloured dot and its word (§23). `compact` is the dot
  alone, the word as hover text and for assistive tech: what leads a history
  row, in a column of its own, where the colour is read down the column and
  the word is one hover away.
-->
<script lang="ts">
  import { display_status, is_active } from '@shared/world'
  import type { QueryHealth, RunStatus } from '@shared/world'

  let {
    status,
    health = 'Healthy',
    compact = false
  }: { status: RunStatus; health?: QueryHealth; compact?: boolean } = $props()

  const label = $derived(display_status(status, health))

  const color = $derived.by(() => {
    if (label === 'Unknown') {
      return 'var(--chart-yellow)'
    }
    if (status === 'Succeeded') {
      return 'var(--chart-green)'
    }
    if (status === 'Failed' || status === 'Error') {
      return 'var(--chart-red)'
    }
    if (status === 'Cancelled') {
      return 'var(--chart-gray)'
    }
    return 'var(--chart-blue)'
  })
</script>

<span
  class="pill"
  class:compact
  role={compact ? 'img' : undefined}
  aria-label={compact ? label : undefined}
  title={compact ? label : undefined}
>
  <span
    class="dot"
    class:pulsing={is_active(status) && label !== 'Unknown'}
    style="background: {color}"
  ></span>
  {#if !compact}{label}{/if}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  /* Alone in a line of text, the dot sits at the text's middle, not on its baseline. */
  .compact {
    vertical-align: middle;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .pulsing {
    animation: pulse 1.6s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
</style>
