<script lang="ts">
  import { manifest_blocking_reason } from '@shared/world'
  import { entity_of, navigate, notify } from '../state.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Spinner } from '$lib/components/ui/spinner'

  let { entity_id }: { entity_id: string } = $props()

  const entity = $derived(entity_of(entity_id))

  // The draft lives here, not in the route — a route stays an address.
  let values = $state<Record<string, string>>({})
  let submitting = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    if (entity !== undefined) {
      const draft: Record<string, string> = {}
      for (const name of entity.parameter_names) {
        draft[name] = ''
      }
      values = draft
    }
  })

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (entity === undefined || submitting) {
      return
    }
    submitting = true
    error = null
    const result = await window.coco.start_run(entity.name, $state.snapshot(values))
    submitting = false
    if (result.ok) {
      notify(`Run ${result.run_id} started.`)
      navigate(
        entity.kind === 'Job'
          ? { page: 'job_run', job_id: entity_id, run_id: result.run_id }
          : { page: 'bench_run', bench_id: entity_id, run_id: result.run_id }
      )
    } else {
      // The draft is preserved on refusal, as in coco (§31).
      error = result.message
    }
  }
</script>

{#if entity !== undefined}
  <nav>
    <button class="crumb" onclick={() => navigate({ page: 'entity', entity_id })}>
      {entity.name}
    </button>
    <span class="crumb-sep">›</span>
    <span>Start</span>
  </nav>

  <h1>{entity.kind === 'Job' ? 'Start Job' : 'Start Bench'}</h1>

  {#if manifest_blocking_reason(entity.manifest) !== null}
    <p class="blocking">{manifest_blocking_reason(entity.manifest)}</p>
  {:else}
    <form onsubmit={submit}>
      {#each entity.parameter_names as name (name)}
        <!-- The label wraps its field, so the name needs no `for`. -->
        <Label class="mb-3 flex flex-col items-stretch gap-1 font-normal">
          <span class="text-description">{name}</span>
          <Input type="text" bind:value={values[name]} disabled={submitting} />
        </Label>
      {:else}
        <p class="none">This experiment takes no parameters.</p>
      {/each}

      {#if error !== null}
        <div class="error">
          {#each error.split('\n') as line, index (index)}
            <p>{line}</p>
          {/each}
        </div>
      {/if}

      <div class="actions">
        <Button type="submit" disabled={submitting}>
          {#if submitting}<Spinner />Starting…{:else}Start{/if}
        </Button>
      </div>
    </form>
  {/if}
{/if}

<style>
  nav {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--description);
    margin-bottom: 8px;
  }

  .crumb {
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    cursor: pointer;
  }

  .crumb-sep {
    opacity: 0.6;
  }

  h1 {
    margin: 0 0 16px;
    font-size: 20px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  form {
    max-width: 460px;
  }

  .error {
    margin: 12px 0;
    padding: 10px 12px;
    border: 1px solid var(--error);
    border-radius: 3px;
    color: var(--error);
  }

  .error p {
    margin: 0 0 6px;
  }

  .error p:last-child {
    margin-bottom: 0;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
  }

  .blocking {
    color: var(--warning);
  }

  .none {
    color: var(--description);
    font-style: italic;
  }
</style>
