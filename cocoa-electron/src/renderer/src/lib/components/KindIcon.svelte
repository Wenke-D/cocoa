<!--
  What an experiment is, as a sign in its kind's colour: a flask for a job,
  stacked layers for a campaign — the many calls it is made of. The same
  sign leads the Explorer's row and the overview's tile, so the one is
  recognised in the other.
-->
<script lang="ts">
  import type { EntityKind } from '@shared/world'
  import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical'
  import LayersIcon from '@lucide/svelte/icons/layers'

  let { kind, size = 16 }: { kind: EntityKind; size?: number } = $props()
</script>

{#if kind === 'Campaign'}
  <LayersIcon {size} strokeWidth={1.75} color="var(--kind-campaign)" aria-hidden="true" />
{:else}
  <FlaskConicalIcon {size} strokeWidth={1.75} color="var(--kind-job)" aria-hidden="true" />
{/if}
