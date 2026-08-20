<script lang="ts">
  import { displayStatus, isActive } from '@shared/world'
  import type { QueryHealth, RunStatus } from '@shared/world'

  let { status, health = 'Healthy' }: { status: RunStatus; health?: QueryHealth } = $props()

  const label = $derived(displayStatus(status, health))

  const color = $derived.by(() => {
    if (label === 'Unknown') return 'var(--chart-yellow)'
    if (status === 'Succeeded') return 'var(--chart-green)'
    if (status === 'Failed' || status === 'Error') return 'var(--chart-red)'
    if (status === 'Cancelled') return 'var(--chart-gray)'
    return 'var(--chart-blue)'
  })
</script>

<span class="pill">
  <span
    class="dot"
    class:pulsing={isActive(status) && label !== 'Unknown'}
    style="background: {color}"
  ></span>
  {label}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
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
