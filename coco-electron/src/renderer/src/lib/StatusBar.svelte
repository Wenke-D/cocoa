<script lang="ts">
  import { format_relative } from '@shared/world'
  import { active_run_count, app, refresh_now } from '../state.svelte'

  const active = $derived(active_run_count())

  // A refresh the user asks for is never the tick that gets dropped, and it
  // always answers — the backend sends a notice either way, so the button
  // does not have to guess whether it worked.
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
    <button
      class="refresh"
      title="Refresh now"
      aria-label="Refresh now"
      onclick={refresh}
      disabled={asking}>⟳</button
    >
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

  .refresh {
    background: none;
    border: none;
    padding: 0 4px;
    margin-left: 2px;
    color: var(--description);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  .refresh:hover:not(:disabled) {
    color: var(--strong-foreground);
  }

  .refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
