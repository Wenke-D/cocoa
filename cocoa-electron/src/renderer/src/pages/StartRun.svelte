<!--
  The Start page (§15): one field per declared parameter, shaped as declared
  (§17.3) — a text field, a choice, lines, or ticks — each under its name
  and description. Nothing is chosen for the user: an enum opens with
  nothing picked, because a value the form picked is indistinguishable from
  one the user did (§15.3).
-->
<script lang="ts">
  import { manifest_blocking_reason } from '@shared/world'
  import { describe_values } from '@shared/params'
  import type { ParamSpec, ParamValue, Params } from '@shared/params'
  import { untrack } from 'svelte'
  import { entity_of, navigate, notify, take_prefill } from '../state.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import * as Select from '$lib/components/ui/select'
  import { Spinner } from '$lib/components/ui/spinner'
  import { Textarea } from '$lib/components/ui/textarea'

  let { entity_id }: { entity_id: string } = $props()

  const entity = $derived(entity_of(entity_id))

  // The draft lives here, not in the route — a route stays an address. Two
  // maps, by widget: `text` holds what a text field, a choice or a lines box
  // holds (nothing as ''); `ticked` holds the values a list of choices has
  // ticked, in the manifest's order.
  let text = $state<Record<string, string>>({})
  let ticked = $state<Record<string, string[]>>({})
  let submitting = $state(false)
  let error = $state<string | null>(null)

  // Empty, unless a run in the history was asked to fill it (§22.6). The
  // prefill is read untracked: taking it clears it, and the effect must not
  // run again for that.
  $effect(() => {
    if (entity !== undefined) {
      const prefill = untrack(() => take_prefill(entity_id)) ?? {}
      const next_text: Record<string, string> = {}
      const next_ticked: Record<string, string[]> = {}
      for (const spec of entity.parameters) {
        const given: ParamValue | undefined = prefill[spec.name]
        if (spec.list && spec.values !== null) {
          next_ticked[spec.name] = Array.isArray(given) ? [...given] : []
        } else if (spec.list) {
          next_text[spec.name] = Array.isArray(given) ? given.join('\n') : ''
        } else {
          next_text[spec.name] = typeof given === 'string' ? given : ''
        }
      }
      text = next_text
      ticked = next_ticked
    }
  })

  function tick(name: string, value: string, on: boolean, order: string[]): void {
    const had = ticked[name] ?? []
    const next = on ? [...had, value] : had.filter((item) => item !== value)
    ticked[name] = order.filter((item) => next.includes(item))
  }

  /** What the form would start with: every field that has something in it, shaped for its spec. */
  function values_of(specs: ParamSpec[]): Params {
    const params: Params = {}
    for (const spec of specs) {
      if (spec.list && spec.values !== null) {
        const picked = ticked[spec.name] ?? []
        if (picked.length > 0) {
          params[spec.name] = [...picked]
        }
        continue
      }
      const raw = text[spec.name] ?? ''
      if (spec.list) {
        const lines = raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
        if (lines.length > 0) {
          params[spec.name] = lines
        }
      } else if (raw.trim() !== '') {
        params[spec.name] = raw
      }
    }
    return params
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (entity === undefined || submitting) {
      return
    }
    submitting = true
    error = null
    const result = await window.cocoa.start_run(entity.name, values_of(entity.parameters))
    submitting = false
    if (result.ok) {
      notify(`Run ${result.run_id} started.`)
      navigate(
        entity.kind === 'Job'
          ? { page: 'job_run', job_id: entity_id, run_id: result.run_id }
          : { page: 'bench_run', bench_id: entity_id, run_id: result.run_id }
      )
    } else {
      // The draft is preserved on refusal, as in cocoa (§31).
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
      {#each entity.parameters as spec (spec.name)}
        {@const id = `param-${spec.name}`}
        <div class="field">
          {#if spec.list && spec.values !== null}
            <div class="name" id={`${id}-name`}>
              {spec.name} <span class="type">{describe_values(spec)}</span>
            </div>
          {:else}
            <Label for={id} class="name">
              {spec.name} <span class="type">{describe_values(spec)}</span>
            </Label>
          {/if}
          <p class="description">{spec.description}</p>

          {#if spec.list && spec.values !== null}
            <div class="choices" role="group" aria-labelledby={`${id}-name`}>
              {#each spec.values as value (value)}
                <label class="choice">
                  <Checkbox
                    checked={(ticked[spec.name] ?? []).includes(value)}
                    onCheckedChange={(on: boolean) => tick(spec.name, value, on, spec.values ?? [])}
                    disabled={submitting}
                  />
                  {value}
                </label>
              {/each}
            </div>
          {:else if spec.list}
            <Textarea
              {id}
              bind:value={text[spec.name]}
              disabled={submitting}
              placeholder="One per line"
              rows={3}
            />
          {:else if spec.values !== null}
            <Select.Root type="single" bind:value={text[spec.name]} disabled={submitting}>
              <Select.Trigger {id} class="w-full">
                {text[spec.name] === '' ? 'Choose…' : text[spec.name]}
              </Select.Trigger>
              <Select.Content>
                {#each spec.values as value (value)}
                  <Select.Item {value} label={value} />
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
            <Input {id} type="text" bind:value={text[spec.name]} disabled={submitting} />
          {/if}
        </div>
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

  .field {
    margin-bottom: 16px;
  }

  .field :global(.name),
  .name {
    display: block;
    font-weight: 500;
    color: var(--strong-foreground);
  }

  .type {
    margin-left: 6px;
    font-weight: 400;
    color: var(--description);
  }

  .description {
    margin: 2px 0 6px;
    color: var(--description);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
  }

  .choice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
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
