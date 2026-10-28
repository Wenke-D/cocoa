<!--
  A run's status as a chip: a coloured dot and its word on a wash of the
  same colour (§23). `compact` is the dot alone, ringed in its wash, the word
  as hover text and for assistive tech: what leads a history row, in a
  column of its own, where the colour is read down the column and the word
  is one hover away.
-->
<script lang="ts">
  import { is_active } from '@shared/run_status'
  import { display_status } from '../../format'
  import { tone_color, tone_of } from '../../tone'
  import type { QueryHealth, RunStatus } from '@shared/world'

  let {
    status,
    health = 'Healthy',
    compact = false
  }: { status: RunStatus; health?: QueryHealth; compact?: boolean } = $props()

  const label = $derived(display_status(status, health))

  // A status nobody can currently see is a warning, whatever it last was.
  const color = $derived(tone_color(label === 'Unknown' ? 'warn' : tone_of(status)))
</script>

<span
  class="pill"
  class:compact
  style="--tone: {color}"
  role={compact ? 'img' : undefined}
  aria-label={compact ? label : undefined}
  title={compact ? label : undefined}
>
  <span class="dot" class:pulsing={is_active(status) && label !== 'Unknown'}></span>
  {#if !compact}{label}{/if}
</span>

<style>
  /* The word is the tone mixed toward the strongest text, so it keeps its
     hue and still reads on the wash in either scheme. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 8px 0 7px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--tone) 14%, transparent);
    color: color-mix(in srgb, var(--tone) 68%, var(--strong-foreground));
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }

  /* Alone in a line of text, the dot sits at the text's middle, not on its baseline. */
  .compact {
    height: auto;
    padding: 0;
    background: none;
    vertical-align: middle;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tone);
    flex-shrink: 0;
  }

  .compact .dot {
    width: 9px;
    height: 9px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 22%, transparent);
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

  @media (prefers-reduced-motion: reduce) {
    .pulsing {
      animation: none;
    }
  }
</style>
