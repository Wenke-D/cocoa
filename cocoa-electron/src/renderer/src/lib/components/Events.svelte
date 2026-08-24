<!--
  What happened, newest first (§11.1): the moment and the experiment on one
  line, the run and what happened on the next — the last coloured by what it
  means. An entry about something still listed is a link to it.
-->
<script lang="ts">
  import { format_clock } from '@shared/world'
  import { app, go_to } from '../../state.svelte'
  import ViewTitle from './ViewTitle.svelte'

  const entries = $derived([...app.journal].reverse())
</script>

{#snippet body(entry: (typeof entries)[number])}
  <span class="at mono">{format_clock(entry.at)}</span>
  {#if entry.name === ''}
    <!-- Nobody's news — a refresh that failed — is one line. -->
    <span class="what {entry.tone}">{entry.what}</span>
  {:else}
    <span class="name">{entry.name}</span>
    <span class="run mono">{entry.run === null ? '' : `run ${entry.run}`}</span>
    <span class="what {entry.tone}">{entry.what}</span>
  {/if}
{/snippet}

<ViewTitle title="EVENTS" />
<div class="list">
  {#each entries as entry (entry)}
    {#if entry.target !== null}
      {@const target = entry.target}
      <button class="entry link" onclick={() => go_to(target)}>{@render body(entry)}</button>
    {:else}
      <div class="entry">{@render body(entry)}</div>
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
    padding: 6px 16px;
    border: none;
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

  .neutral {
    color: var(--chart-gray);
  }

  .info {
    color: var(--chart-blue);
  }

  .good {
    color: var(--chart-green);
  }

  .bad {
    color: var(--chart-red);
  }

  .warn {
    color: var(--chart-yellow);
  }

  .empty {
    padding: 2px 16px;
    color: var(--description);
    font-style: italic;
  }
</style>
