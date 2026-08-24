<!--
  A refusal that has to be read: the backend said no to something the user
  asked for outright — a start from the history with parameters the manifest
  no longer takes — and a notice that fades is not enough. One button.
-->
<script lang="ts">
  import { close_overlay } from '../../state.svelte'
  import type { Overlay } from '../../state.svelte'
  import ModalFrame from './ModalFrame.svelte'
  import { Button } from '$lib/components/ui/button'

  let { overlay }: { overlay: Overlay & { kind: 'refused' } } = $props()
</script>

<ModalFrame title={overlay.title} onclose={close_overlay}>
  {#snippet body()}
    {#each overlay.message.split('\n') as line, index (index)}
      <p>{line}</p>
    {/each}
  {/snippet}
  {#snippet actions()}
    <Button class="ml-auto" onclick={close_overlay}>OK</Button>
  {/snippet}
</ModalFrame>

<style>
  p {
    margin: 0 0 4px;
    line-height: 1.5;
    user-select: text;
  }
</style>
