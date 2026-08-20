<script lang="ts">
  import { manifestBlockingReason } from '@shared/world'
  import { entityOf, navigate, notify } from '../state.svelte'

  let { entityId }: { entityId: string } = $props()

  const entity = $derived(entityOf(entityId))

  // The draft lives here, not in the route — a route stays an address.
  let values = $state<Record<string, string>>({})
  let submitting = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    if (entity !== undefined) {
      const draft: Record<string, string> = {}
      for (const name of entity.parameter_names) draft[name] = ''
      values = draft
    }
  })

  function fillLastArgs(): void {
    if (entity === undefined) return
    for (const name of Object.keys(values)) {
      values[name] = entity.last_used[name] ?? values[name]
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (entity === undefined || submitting) return
    submitting = true
    error = null
    const result = await window.coco.startRun(entity.name, $state.snapshot(values))
    submitting = false
    if (result.ok) {
      notify(`Run ${result.runId} started.`)
      navigate(
        entity.kind === 'Job'
          ? { page: 'jobRun', jobId: entityId, runId: result.runId }
          : { page: 'benchRun', benchId: entityId, runId: result.runId }
      )
    } else {
      // The draft is preserved on refusal, as in coco (§31).
      error = result.message
    }
  }
</script>

{#if entity !== undefined}
  <nav>
    <button class="crumb" onclick={() => navigate({ page: 'entity', entityId })}>
      {entity.name}
    </button>
    <span class="crumb-sep">›</span>
    <span>Start</span>
  </nav>

  <h1>{entity.kind === 'Job' ? 'Start Job' : 'Start Bench'}</h1>

  {#if manifestBlockingReason(entity.manifest) !== null}
    <p class="blocking">{manifestBlockingReason(entity.manifest)}</p>
  {:else}
    <form onsubmit={submit}>
      {#each entity.parameter_names as name (name)}
        <label>
          <span>{name}</span>
          <input type="text" bind:value={values[name]} disabled={submitting} />
        </label>
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
        {#if Object.keys(entity.last_used).length > 0}
          <button type="button" class="secondary" onclick={fillLastArgs} disabled={submitting}>
            Fill from last run
          </button>
        {/if}
        <button type="submit" class="primary" disabled={submitting}>
          {submitting ? 'Starting…' : 'Start'}
        </button>
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

  label {
    display: block;
    margin-bottom: 12px;
  }

  label span {
    display: block;
    margin-bottom: 4px;
    color: var(--description);
  }

  input {
    width: 100%;
    height: 26px;
    padding: 0 8px;
    background: var(--input-bg);
    color: var(--strong-foreground);
    border: 1px solid var(--control-border);
    border-radius: 3px;
  }

  input:focus {
    outline: 1px solid var(--accent);
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
