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
  /* Flush with the section headings under it — EXPLORER and CAMPAIGNS share a
     left edge; only rows are indented (§8.3). */
  .title {
    display: flex;
    align-items: center;
    height: 38px;
    padding: 0 8px 0 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--description);
  }
</style>
