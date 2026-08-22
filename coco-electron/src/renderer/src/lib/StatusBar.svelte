<script lang="ts">
  import { format_relative } from '@shared/world'
  import { active_run_count, app, refresh_now } from '../state.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw'

  const active = $derived(active_run_count())

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
    <span>coco engine</span>
    <span class="sep">·</span>
    <span>{active} active {active === 1 ? 'run' : 'runs'}</span>
    {#if app.world.last_refresh !== null}
      <span class="sep">·</span>
      <span>refreshed {format_relative(app.world.last_refresh, app.now_ms)}</span>
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
    <span>engine offline — is coco running?</span>
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
</style>
