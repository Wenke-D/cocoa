<!--
  The trail back. Every page that is *inside* something says so the same way,
  and the trailing crumb — the page you are on — is never a link (§8.4, §19).
-->
<script lang="ts">
  import type { Crumb } from '../../ui_state'
  import { navigate } from '../../state.svelte'

  let { crumbs }: { crumbs: Crumb[] } = $props()
</script>

<nav>
  {#each crumbs as crumb, index (index)}
    {#if index > 0}<span class="sep">›</span>{/if}
    {#if crumb.route !== null}
      {@const route = crumb.route}
      <button class="crumb" class:mono={crumb.mono} onclick={() => navigate(route)}>
        {crumb.label}
      </button>
    {:else}
      <span class="here" class:mono={crumb.mono}>{crumb.label}</span>
    {/if}
  {/each}
</nav>

<style>
  nav {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--description);
    margin-bottom: 8px;
  }

  .crumb {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--link);
    cursor: pointer;
  }

  .crumb:hover {
    text-decoration: underline;
  }

  .sep {
    opacity: 0.6;
  }

  .here {
    color: var(--description);
  }
</style>
