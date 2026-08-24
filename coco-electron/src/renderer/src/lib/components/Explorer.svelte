<!--
  The Explorer (§8.3, §11.2): the benches and jobs the user has added, as two
  panes one above the other, each with its own scroll, the divider between
  them draggable. Benches first — a bench is what the jobs are for.
-->
<script lang="ts">
  import {
    add_folder,
    app,
    has_active_run,
    navigate,
    request_remove,
    selected_entity_id
  } from '../../state.svelte'
  import { EXPLORER_MAX_SPLIT, EXPLORER_MIN_SPLIT } from '../../ui_state'
  import type { Entity } from '@shared/world'
  import * as ContextMenu from '$lib/components/ui/context-menu'
  import ViewTitle from './ViewTitle.svelte'

  const jobs = $derived(app.world.entities.filter((entity) => entity.kind === 'Job'))
  const benches = $derived(app.world.entities.filter((entity) => entity.kind === 'Bench'))
  const selected = $derived(selected_entity_id())

  let panes = $state<HTMLDivElement | null>(null)
  let dragging = $state(false)

  function open(entity: Entity): void {
    navigate({ page: 'entity', entity_id: entity.id })
  }

  // The same drag as the sidebar's edge (App.svelte): listening on the
  // window, so a pointer that outruns the divider still moves it.
  function start_drag(event: PointerEvent): void {
    event.preventDefault()
    dragging = true
    window.addEventListener('pointermove', drag)
    window.addEventListener('pointerup', end_drag)
    window.addEventListener('pointercancel', end_drag)
  }

  function drag(event: PointerEvent): void {
    if (!dragging || panes === null) {
      return
    }
    const box = panes.getBoundingClientRect()
    const share = (event.clientY - box.top) / box.height
    app.explorer_split = Math.min(EXPLORER_MAX_SPLIT, Math.max(EXPLORER_MIN_SPLIT, share))
  }

  function end_drag(): void {
    dragging = false
    window.removeEventListener('pointermove', drag)
    window.removeEventListener('pointerup', end_drag)
    window.removeEventListener('pointercancel', end_drag)
  }
</script>

<!--
  Each row is its own context menu's trigger (the `child` snippet makes the
  row button the trigger rather than wrapping it). Rendered rather than
  native, for the same reason VS Code renders its own: it follows the app's
  theme, and it is reachable by the things that verify this app. A row that
  leaves the world takes its menu with it.
-->
{#snippet rows(entities: Entity[])}
  {#each entities as entity (entity.id)}
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            class="row"
            class:selected={entity.id === selected}
            onclick={() => open(entity)}
          >
            <span class="name">{entity.name}</span>
            {#if has_active_run(entity)}
              <span class="active-dot" title="has an active run"></span>
            {/if}
            {#if entity.manifest !== 'Valid'}
              <span class="warn" title="manifest problem">!</span>
            {/if}
          </button>
        {/snippet}
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item onSelect={() => request_remove(entity.id)}>
          Remove from Explorer
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  {:else}
    <div class="empty">none</div>
  {/each}
{/snippet}

<ViewTitle title="EXPLORER">
  {#snippet actions()}
    <button class="add" title="Add folder" aria-label="Add folder" onclick={add_folder}>+</button>
  {/snippet}
</ViewTitle>

<div class="panes" bind:this={panes}>
  <section class="pane" style="flex-grow: {app.explorer_split}">
    <h3 class="section">BENCHES</h3>
    <div class="list">{@render rows(benches)}</div>
  </section>
  <div
    class="splitter"
    class:dragging
    role="separator"
    aria-orientation="horizontal"
    onpointerdown={start_drag}
  ></div>
  <section class="pane" style="flex-grow: {1 - app.explorer_split}">
    <h3 class="section">JOBS</h3>
    <div class="list">{@render rows(jobs)}</div>
  </section>
</div>

<style>
  .add {
    margin-left: auto;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--foreground);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }

  .add:hover {
    background: var(--row-hover);
  }

  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* The two panes share the height by `flex-grow`, which is the split. */
  .pane {
    flex-basis: 0;
    flex-shrink: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* A heading, not a band: bold, uppercase and flush left, its rows indented
     under it, as VS Code draws its sections. It has no ground of its own, so
     the one ground in the list is the selection's (§8.3). */
  .section {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    height: 22px;
    margin: 0;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--strong-foreground);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 0;
  }

  /* The divider is drawn as the lower pane's top edge, so there is a line to
     see; the splitter straddles it, invisible until the pointer is on it,
     when it turns the accent colour, as VS Code's sash does — the line says
     there is a divider, the colour says it drags. */
  .splitter + .pane {
    border-top: 1px solid var(--border);
  }

  .splitter {
    height: 4px;
    margin: -2px 0;
    flex-shrink: 0;
    cursor: row-resize;
    z-index: 1;
  }

  .splitter:hover,
  .splitter.dragging {
    background: var(--accent);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 24px;
    padding: 0 16px;
    border: none;
    background: none;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }

  .row:hover {
    background: var(--row-hover);
  }

  .row.selected {
    background: var(--row-selected);
    color: var(--row-selected-fg);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .active-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--chart-blue);
    flex-shrink: 0;
  }

  .warn {
    color: var(--warning);
    font-weight: 700;
    flex-shrink: 0;
  }

  .empty {
    padding: 2px 16px;
    color: var(--description);
    font-style: italic;
  }
</style>
