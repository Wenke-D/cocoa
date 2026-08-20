<script lang="ts">
  import { addFolder, app } from '../state.svelte'
</script>

<div class="empty">
  {#if !app.connected}
    <h2>Starting</h2>
    <p>Reading the registered experiment folders.</p>
  {:else if app.world.entities.length === 0}
    <!-- §12: the empty page must not look like an error. -->
    <h2>No jobs or benches have been added.</h2>
    <p>Add a folder containing a valid experiment manifest to begin.</p>
    <button class="primary" onclick={addFolder}>Add Folder</button>
  {:else}
    <h2>coco</h2>
    <p>Select an experiment in the Explorer.</p>
  {/if}
</div>

<style>
  .empty {
    padding-top: 15vh;
    text-align: center;
    color: var(--description);
  }

  h2 {
    color: var(--foreground);
    font-weight: 500;
  }

  p {
    max-width: 420px;
    margin: 8px auto;
    line-height: 1.5;
  }

  .primary {
    margin-top: 12px;
    padding: 6px 18px;
  }
</style>
