<!--
  The icon strip at the far left (§8.2), on the frame's cocoa brown: the
  bean at the top, which goes back to the empty page, then one item per
  sidebar view, the open one on a lighter wash with a caramel edge, Active
  Runs carrying the count as a badge.
-->
<script lang="ts">
  import { navigate, select_view } from '../../navigation'
  import { app } from '../../state.svelte'
  import { active_run_count } from '../../world_queries'
  import type { SidebarView } from '../../navigation'
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
  <!-- The product mark, drawn as on the empty page (Empty.svelte), small. -->
  <button class="home" title="cocoa" aria-label="Home" onclick={() => navigate({ page: 'empty' })}>
    <svg viewBox="0 0 1024 1024" width="28" height="28" aria-hidden="true">
      <rect width="1024" height="1024" rx="232" fill="var(--mark-tile)" />
      <g transform="rotate(-28 512 512)">
        <ellipse cx="512" cy="512" rx="330" ry="216" fill="var(--mark-bean)" />
        <path
          d="M 241 512 Q 512 404 783 512"
          fill="none"
          stroke="var(--mark-tile)"
          stroke-width="37"
          stroke-linecap="round"
        />
      </g>
    </svg>
  </button>
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
    background: var(--chrome-bg);
  }

  .home {
    width: 48px;
    height: 52px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    cursor: pointer;
  }

  .home svg {
    transition: transform 120ms ease-out;
  }

  .home:hover svg {
    transform: scale(1.06);
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
    color: var(--chrome-muted);
    cursor: pointer;
  }

  .item:hover {
    color: var(--chrome-fg);
    background: var(--chrome-hover);
  }

  /* The open view: a lighter wash, and the accent on its edge — on the dark
     frame a wash alone is too quiet to find at a glance. */
  .item.open {
    color: var(--chrome-fg);
    background: var(--chrome-active);
  }

  .item.open::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }

  .badge {
    position: absolute;
    top: 7px;
    right: 6px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 0 0 2px var(--chrome-bg);
    font-size: 10px;
    font-weight: 700;
    line-height: 17px;
    text-align: center;
  }
</style>
