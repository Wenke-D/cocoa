<!--
  One row of a job's or a bench's history (§22): the cells are the page's;
  this is the row's behaviour — a click opens the run, and a right-click
  offers the run's parameters again (§22.6).
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { navigate, prefill_start, start_again } from '../state.svelte'
  import type { Route } from '../state.svelte'
  import * as ContextMenu from '$lib/components/ui/context-menu'

  let {
    entity_id,
    run_id,
    params,
    route,
    children
  }: {
    entity_id: string
    run_id: string
    params: Record<string, string>
    route: Route
    children: Snippet
  } = $props()
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      <tr {...props} onclick={() => navigate(route)}>{@render children()}</tr>
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item onSelect={() => void start_again(entity_id, params)}>
      Start again with these parameters
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => prefill_start(entity_id, run_id, params)}>
      Start with these parameters…
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
