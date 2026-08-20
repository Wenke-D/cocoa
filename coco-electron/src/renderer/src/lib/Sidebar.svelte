<script lang="ts">
  import {
    addFolder,
    app,
    hasActiveRun,
    navigate,
    openMenu,
    selectedEntityId
  } from '../state.svelte'
  import type { Entity } from '@shared/world'

  const jobs = $derived(app.world.entities.filter((entity) => entity.kind === 'Job'))
  const benches = $derived(app.world.entities.filter((entity) => entity.kind === 'Bench'))
  const selected = $derived(selectedEntityId())

  function open(entity: Entity): void {
    navigate({ page: 'entity', entityId: entity.id })
  }
</script>

{#snippet section(title: string, entities: Entity[])}
  <div class="section-header">{title}</div>
  {#each entities as entity (entity.id)}
    <button
      class="row"
      class:selected={entity.id === selected}
      onclick={() => open(entity)}
      oncontextmenu={(event) => {
        event.preventDefault()
        openMenu(entity.id, event.clientX, event.clientY)
      }}
    >
      <span class="name">{entity.name}</span>
      {#if hasActiveRun(entity)}
        <span class="active-dot" title="has an active run"></span>
      {/if}
      {#if entity.manifest !== 'Valid'}
        <span class="warn" title="manifest problem">!</span>
      {/if}
    </button>
  {:else}
    <div class="empty">none</div>
  {/each}
{/snippet}

<div class="sidebar">
  <div class="title">
    <span>EXPLORER</span>
    <button class="add" title="Add folder" aria-label="Add folder" onclick={addFolder}>+</button>
  </div>
  {@render section('JOBS', jobs)}
  {@render section('BENCHES', benches)}
</div>

<style>
  .sidebar {
    padding-bottom: 12px;
  }

  .title {
    display: flex;
    align-items: center;
    padding: 10px 8px 6px 16px;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--description);
  }

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

  .section-header {
    padding: 8px 16px 2px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--description);
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
