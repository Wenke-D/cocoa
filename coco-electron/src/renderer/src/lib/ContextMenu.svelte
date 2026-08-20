<!--
  The Explorer's right-click menu. Rendered rather than native, for the same
  reason VS Code renders its own: it follows the app's theme, and it is
  reachable by the things that verify this app.
-->
<script lang="ts">
  import { app, close_menu, entity_of, request_remove } from '../state.svelte'

  let { menu }: { menu: NonNullable<typeof app.menu> } = $props()

  const entity = $derived(entity_of(menu.entity_id))

  let element = $state<HTMLDivElement | null>(null)

  // Opened at the pointer, then nudged back inside the window if it would
  // hang off the edge.
  const position = $derived.by(() => {
    const width = element?.offsetWidth ?? 200
    const height = element?.offsetHeight ?? 40
    return {
      left: Math.min(menu.x, window.innerWidth - width - 4),
      top: Math.min(menu.y, window.innerHeight - height - 4)
    }
  })

  function on_key(event: KeyboardEvent): void {
    if (event.key === 'Escape') close_menu()
  }
</script>

<svelte:window onkeydown={on_key} />

<!-- A click anywhere else closes the menu, which is what the backdrop is for. -->
<div
  class="backdrop"
  role="presentation"
  onclick={close_menu}
  oncontextmenu={(event) => {
    event.preventDefault()
    close_menu()
  }}
></div>

{#if entity !== undefined}
  <div
    class="menu"
    bind:this={element}
    role="menu"
    tabindex="-1"
    style="left: {position.left}px; top: {position.top}px"
  >
    <button role="menuitem" onclick={() => request_remove(entity.id)}>Remove from Explorer</button>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .menu {
    position: fixed;
    z-index: 11;
    min-width: 180px;
    padding: 4px;
    background: var(--widget-bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }

  .menu button {
    display: block;
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--row-hover);
    color: var(--row-selected-fg);
  }
</style>
