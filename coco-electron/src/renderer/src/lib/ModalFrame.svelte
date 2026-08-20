<!--
  The shell every modal shares — port of `ui/overlays/modal_frame`. A modal is
  a temporary action, not a place (§9): it is dismissible, Escape closes it,
  and it never becomes an address.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

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

  let dialog = $state<HTMLDialogElement | null>(null)

  $effect(() => {
    dialog?.showModal()
  })

  /** The backdrop is the dialog element itself; a click on it dismisses. */
  function on_backdrop(event: MouseEvent): void {
    if (event.target === dialog && !busy) onclose()
  }
</script>

<dialog bind:this={dialog} {onclose} onclick={on_backdrop}>
  <h2>{title}</h2>
  {@render body()}
  {#if error !== null}
    <p class="error">{error}</p>
  {/if}
  <div class="actions">{@render actions()}</div>
</dialog>

<style>
  dialog {
    width: 420px;
    max-width: calc(100vw - 40px);
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--widget-bg);
    color: var(--foreground);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }

  h2 {
    margin: 0 0 14px;
    font-size: 16px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

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
