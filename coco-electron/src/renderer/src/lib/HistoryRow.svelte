<!--
  One row of a job's or a bench's history (§22): the cells are the page's;
  this is the row's behaviour — a click opens the run, and a right-click
  offers the run's parameters again (§22.6) — Start over runs them now,
  Refill… puts them in the Start page — and, for a finished run, Delete…
  (§16.4).
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { Params } from '@shared/params'
  import { navigate, prefill_start, request_delete, start_again } from '../state.svelte'
  import type { Route } from '../state.svelte'
  import * as ContextMenu from '$lib/components/ui/context-menu'

  let {
    entity_id,
    run_id,
    params,
    route,
    deletable,
    children
  }: {
    entity_id: string
    run_id: string
    params: Params
    route: Route
    /** Finished runs only: an active run is cancelled, never deleted (§16.4). */
    deletable: boolean
    children: Snippet
  } = $props()

  function delete_target(): void {
    request_delete(
      route.page === 'bench_run'
        ? { kind: 'bench_run', bench_id: entity_id, run_id }
        : { kind: 'job_run', job_id: entity_id, run_id }
    )
  }
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      <tr {...props} onclick={() => navigate(route)}>{@render children()}</tr>
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item onSelect={() => void start_again(entity_id, params)}
      >Start over</ContextMenu.Item
    >
    <ContextMenu.Item onSelect={() => prefill_start(entity_id, run_id, params)}
      >Refill…</ContextMenu.Item
    >
    <ContextMenu.Separator />
    <ContextMenu.Item variant="destructive" disabled={!deletable} onSelect={delete_target}>
      Delete…
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
