<!--
  The icon strip at the far left (§8.2): one item per sidebar view, the open
  one marked on its leading edge, Active Runs carrying the count as a badge.
-->
<script lang="ts">
  import { active_run_count, app, select_view } from '../state.svelte'
  import type { SidebarView } from '../state.svelte'
  import FilesIcon from '@lucide/svelte/icons/files'
  import ActivityIcon from '@lucide/svelte/icons/activity'
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text'

  const active = $derived(active_run_count())
  const badge = $derived(active === 0 ? null : active > 99 ? '99+' : String(active))

  const items: { view: SidebarView; label: string; icon: typeof FilesIcon }[] = [
    { view: 'explorer', label: 'Explorer', icon: FilesIcon },
    { view: 'runs', label: 'Active Runs', icon: ActivityIcon },
    { view: 'events', label: 'Events', icon: ScrollTextIcon }
  ]
</script>

<nav aria-label="Views">
  {#each items as item (item.view)}
    {@const open = app.sidebar_open && app.sidebar_view === item.view}
    <button
      class="item"
      class:open
      title={item.label}
      aria-label={item.label}
      aria-pressed={open}
      onclick={() => select_view(item.view)}
    >
      <item.icon class="size-6" strokeWidth={1.5} />
      {#if item.view === 'runs' && badge !== null}
        <span class="badge">{badge}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  nav {
    width: 48px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--side-bar-bg);
    border-right: 1px solid var(--border);
  }

  .item {
    position: relative;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--description);
    cursor: pointer;
  }

  .item:hover {
    color: var(--strong-foreground);
  }

  .item.open {
    color: var(--strong-foreground);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .badge {
    position: absolute;
    top: 8px;
    right: 8px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
  }
</style>
