<!-- The row every sidebar view opens with: its name, then its actions (§8.3). -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let { title, actions }: { title: string; actions?: Snippet } = $props()
</script>

<div class="title">
  <span>{title}</span>
  {#if actions !== undefined}
    {@render actions()}
  {/if}
</div>

<style>
  .title {
    display: flex;
    align-items: center;
    padding: 10px 8px 6px 16px;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--description);
  }
</style>
