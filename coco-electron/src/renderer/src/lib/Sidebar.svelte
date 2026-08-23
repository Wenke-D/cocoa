<!-- The sidebar hosts exactly one view at a time, chosen by the activity bar (§8.3). -->
<script lang="ts">
  import { app } from '../state.svelte'
  import ActiveRuns from './ActiveRuns.svelte'
  import Events from './Events.svelte'
  import Explorer from './Explorer.svelte'
</script>

<div class="sidebar">
  {#if app.sidebar_view === 'explorer'}
    <Explorer />
  {:else if app.sidebar_view === 'runs'}
    <ActiveRuns />
  {:else}
    <Events />
  {/if}
</div>

<style>
  .sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
