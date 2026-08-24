<script lang="ts">
  import { format_clock } from '@shared/world'
  import { active_run_count, app, last_change, refresh_now, select_view } from '../../state.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw'

  const active = $derived(active_run_count())
  const last = $derived(last_change())

  // A refresh the user asks for is never the tick that gets dropped, and it
  // always answers — the backend sends a notice either way, so the button
  // does not have to guess whether it worked. Held down until then: the
  // backend takes one person's refresh at a time and ignores a second.
  let asking = $state(false)

  async function refresh(): Promise<void> {
    if (asking) {
      return
    }
    asking = true
    try {
      await refresh_now()
    } finally {
      asking = false
    }
  }
</script>

<footer>
  <span class="dot" class:online={app.connected}></span>
  {#if app.connected}
    <span>cocoa engine</span>
    <span class="sep">·</span>
    <span>{active} active {active === 1 ? 'run' : 'runs'}</span>
    {#if last !== null}
      <span class="sep">·</span>
      <!-- A clock time, not a count that ticks: it changes only when something
           does, and it is always the same width (§8.5). -->
      <button class="change" title="Open Events" onclick={() => select_view('events')}>
        last change <span class="clock">{format_clock(last.at)}</span>
      </button>
    {/if}
    <Button
      variant="ghost"
      size="icon-xs"
      class="refresh ml-0.5 size-5 text-description hover:text-strong"
      title="Refresh now"
      aria-label="Refresh now"
      onclick={refresh}
      disabled={asking}
    >
      {#if asking}
        <Spinner class="size-3.5" />
      {:else}
        <RefreshIcon class="size-3.5" />
      {/if}
    </Button>
  {:else}
    <span>engine offline — is cocoa running?</span>
  {/if}
</footer>

<style>
  footer {
    height: 22px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    background: var(--status-bar-bg);
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--description);
    flex-shrink: 0;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--chart-red);
  }

  .dot.online {
    background: var(--chart-green);
  }

  .sep {
    opacity: 0.5;
  }

  .change {
    border: none;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .change:hover {
    color: var(--strong-foreground);
  }

  .clock {
    font-variant-numeric: tabular-nums;
  }
</style>
