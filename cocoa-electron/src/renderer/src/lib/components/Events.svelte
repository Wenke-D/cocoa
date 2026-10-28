<!--
  What happened, newest first (§11.1): the moment and the experiment on one
  line, the run and what happened on the next — the last coloured by what it
  means. An entry about something still listed is a link to it.
-->
<script lang="ts">
  import { format_clock } from '../../format'
  import { go_to } from '../../navigation'
  import { tone_color } from '../../tone'
  import { app } from '../../state.svelte'
  import ViewTitle from './ViewTitle.svelte'

  const entries = $derived([...app.journal].reverse())
</script>

{#snippet body(entry: (typeof entries)[number])}
  <span class="at mono">{format_clock(entry.at)}</span>
  {#if entry.name === ''}
    <!-- Nobody's news — a refresh that failed — is one line. -->
    <span class="what" style="color: {tone_color(entry.tone)}">{entry.what}</span>
  {:else}
    <span class="name">{entry.name}</span>
    <span class="run mono">{entry.run === null ? '' : `run ${entry.run}`}</span>
    <span class="what" style="color: {tone_color(entry.tone)}">{entry.what}</span>
  {/if}
{/snippet}

<ViewTitle title="EVENTS" />
<div class="list">
  {#each entries as entry (entry)}
    {#if entry.target !== null}
      {@const target = entry.target}
      <button
        class="entry link"
        style="--tone: {tone_color(entry.tone)}"
        onclick={() => go_to(target)}>{@render body(entry)}</button
      >
    {:else}
      <div class="entry" style="--tone: {tone_color(entry.tone)}">{@render body(entry)}</div>
    {/if}
  {:else}
    <div class="empty">Nothing has happened yet.</div>
  {/each}
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 12px;
  }

  /* Two rows on one grid: the moment beside the name, the run beside what
     happened, the left column shared so the two line up. Baselines, not
     boxes, are what align — the mono cells are a size smaller. A rule under
     each entry keeps them apart at a glance. */
  .entry {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    column-gap: 10px;
    row-gap: 1px;
    width: 100%;
    padding: 7px 12px 7px 10px;
    border: none;
    border-left: 3px solid var(--tone);
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--foreground);
    text-align: left;
    line-height: 1.35;
  }

  .link {
    cursor: pointer;
  }

  .link:hover {
    background: var(--row-hover);
  }

  .at,
  .run {
    color: var(--description);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .name {
    color: var(--strong-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .what {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .empty {
    padding: 2px 12px;
    color: var(--description);
    font-style: italic;
  }
</style>
