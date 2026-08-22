<!--
  The shell every modal shares — port of `ui/overlays/modal_frame`, over
  shadcn's Dialog (bits-ui underneath: focus trap, Escape, focus restored on
  close). A modal is a temporary action, not a place (§9): it is dismissible
  and it never becomes an address. While the operation is in flight it cannot
  be dismissed, so its answer has somewhere to land.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as Dialog from '$lib/components/ui/dialog'

  let {
    title,
    error = null,
    busy = false,
    onclose,
    body,
    actions
  }: {
    title: string
    /** Shown under the body when an attempt was refused; the modal stays open. */
    error?: string | null
    /** While an operation is in flight the modal cannot be dismissed. */
    busy?: boolean
    onclose: () => void
    body: Snippet
    actions: Snippet
  } = $props()

  // Open for as long as it is mounted: the parent decides by mounting and
  // unmounting (`app.overlay`), so a dismissal is relayed up, not applied.
  function on_open_change(open: boolean): void {
    if (!open && !busy) {
      onclose()
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={on_open_change}>
  <Dialog.Content
    class="w-[420px] max-w-[calc(100vw-40px)] gap-0 p-5 sm:max-w-[420px]"
    showCloseButton={false}
    escapeKeydownBehavior={busy ? 'ignore' : 'close'}
    interactOutsideBehavior={busy ? 'ignore' : 'close'}
  >
    <Dialog.Header class="mb-3.5">
      <Dialog.Title class="text-base font-semibold text-strong">{title}</Dialog.Title>
    </Dialog.Header>
    {@render body()}
    {#if error !== null}
      <p class="error">{error}</p>
    {/if}
    <div class="actions">{@render actions()}</div>
  </Dialog.Content>
</Dialog.Root>

<style>
  .error {
    margin: 14px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--error);
    border-radius: 3px;
    color: var(--error);
    user-select: text;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: 20px;
  }
</style>
