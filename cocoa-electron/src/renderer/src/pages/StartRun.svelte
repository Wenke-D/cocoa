<!--
  The Start page (§15): one field per declared parameter, shaped as declared
  (§17.3) — a text field, a choice, lines, or ticks — each under its name
  and description. Nothing is chosen for the user: an enum opens with
  nothing picked, because a value the form picked is indistinguishable from
  one the user did (§15.3).
-->
<script lang="ts">
  import { manifest_blocking_reason } from '../format'
  import type { ReplaceTarget, StartResult } from '@shared/protocol'
  import { job_run } from '@shared/world'
  import { describe_values } from '@shared/params'
  import type { ParamSpec, ParamValue, Params } from '@shared/params'
  import { untrack } from 'svelte'
  import { navigate } from '../navigation'
  import { notify } from '../notice'
  import { take_prefill } from '../prefill.svelte'
  import { app } from '../state.svelte'
  import { call_of, entity_name, entity_of } from '../world_queries'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import * as Select from '$lib/components/ui/select'
  import { Spinner } from '$lib/components/ui/spinner'
  import { Textarea } from '$lib/components/ui/textarea'
  import KindIcon from '../lib/components/KindIcon.svelte'
  import PlayIcon from '@lucide/svelte/icons/play'

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
  /** The campaign call this run takes the place of (§18.3), from a call's Refill. */
  let replaces = $state<ReplaceTarget | null>(null)

  /** What the page says above the fields when the run replaces a call. */
  const replacing = $derived.by(() => {
    if (replaces === null) {
      return null
    }
    const step = call_of(replaces.campaign_id, replaces.campaign_run_id, entity_id, replaces.run_id)
    const status = job_run(app.world, entity_id, replaces.run_id)?.status
    const outcome =
      status === 'Failed'
        ? 'failed'
        : status === 'Cancelled'
          ? 'was cancelled'
          : status === 'Error'
            ? 'ended in error'
            : 'ended'
    return (
      `Replaces call ${step?.index ?? '?'} of ${entity_name(entity_of(replaces.campaign_id))} ` +
      `run ${replaces.campaign_run_id}, whose run ${replaces.run_id} ${outcome}. The run you ` +
      `launch takes its place in the campaign run; run ${replaces.run_id} is kept as an ` +
      `earlier attempt.`
    )
  })

  // Empty, unless a run in the history was asked to fill it (§22.6). The
  // prefill is read untracked: taking it clears it, and the effect must not
  // run again for that.
  $effect(() => {
    if (entity !== undefined) {
      const taken = untrack(() => take_prefill(entity_id))
      const prefill = taken?.values ?? {}
      replaces = taken?.replaces ?? null
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
    let result: StartResult
    // A proxy does not cross IPC; the replacement goes as a plain object.
    const target = replaces === null ? undefined : $state.snapshot(replaces)
    try {
      result = await window.cocoa.start_run(entity.name, values_of(entity.parameters), target)
    } catch (cause) {
      result = { ok: false, message: (cause as Error).message }
    }
    submitting = false
    if (result.ok && target !== undefined) {
      // The new run is the call now: shown in the campaign's context (§19).
      notify(`Run ${result.run_id} started in place of run ${target.run_id}.`)
      navigate({
        page: 'campaign_child',
        campaign_id: target.campaign_id,
        campaign_run_id: target.campaign_run_id,
        job_id: entity_id,
        run_id: result.run_id
      })
    } else if (result.ok) {
      notify(`Run ${result.run_id} started.`)
      navigate(
        entity.kind === 'Job'
          ? { page: 'job_run', job_id: entity_id, run_id: result.run_id }
          : { page: 'campaign_run', campaign_id: entity_id, run_id: result.run_id }
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
    <span>Launch</span>
  </nav>

  <!-- The verb alone, as on the overview's button: the crumb above and the
       sign say what is being launched. -->
  <h1><KindIcon kind={entity.kind} size={20} />Launch</h1>

  {#if manifest_blocking_reason(entity.manifest) !== null}
    <p class="blocking">{manifest_blocking_reason(entity.manifest)}</p>
  {:else}
    {#if replacing !== null}
      <p class="replacing">{replacing}</p>
    {/if}
    <form class="panel" onsubmit={submit}>
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
          {#if submitting}<Spinner />Launching…{:else}<PlayIcon />Launch{/if}
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

  .crumb:hover {
    text-decoration: underline;
  }

  .crumb-sep {
    opacity: 0.6;
  }

  h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 16px;
    font-size: 22px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  /* Said before the fields: the run is not a fresh start of the job but a
     campaign call run again in its place. */
  .replacing {
    max-width: 560px;
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--kind-campaign);
    border-radius: 6px;
    background: var(--widget-bg);
    color: var(--strong-foreground);
  }

  /* One panel holds the whole draft, its fields ruled apart, the submit at
     its foot: what is being started is one thing. */
  form {
    max-width: 560px;
    padding: 4px 20px 16px;
  }

  .field {
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }

  .field :global(.name),
  .name {
    display: block;
    font-weight: 500;
    color: var(--strong-foreground);
  }

  .type {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--code-inline-bg);
    font-size: 11px;
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
    margin: 14px 0 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--error) 50%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--error) 8%, transparent);
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
