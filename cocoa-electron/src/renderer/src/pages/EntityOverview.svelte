<script lang="ts">
  import { is_active, is_deletable, is_terminal } from '@shared/run_status'
  import {
    format_duration,
    format_relative,
    format_started_at,
    manifest_blocking_reason,
    origin_label,
    trigger_label
  } from '../format'
  import { campaign_run, job_run } from '@shared/world'
  import { describe_values } from '@shared/params'
  import { navigate } from '../navigation'
  import { request_remove } from '../overlays.svelte'
  import { app } from '../state.svelte'
  import { entity_of } from '../world_queries'
  import { tone_color, tone_of } from '../tone'
  import HistoryRow from '../lib/components/HistoryRow.svelte'
  import KindIcon from '../lib/components/KindIcon.svelte'
  import StatusPill from '../lib/components/StatusPill.svelte'
  import { Button } from '$lib/components/ui/button'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import CircleMinusIcon from '@lucide/svelte/icons/circle-minus'
  import PlayIcon from '@lucide/svelte/icons/play'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'

  let { entity_id }: { entity_id: string } = $props()

  const entity = $derived(entity_of(entity_id))
  const blocking = $derived(entity === undefined ? null : manifest_blocking_reason(entity.manifest))

  const job_runs = $derived(
    (app.world.runs_by_job[entity_id] ?? [])
      .map((id) => job_run(app.world, entity_id, id))
      .filter((run) => run !== undefined)
      .reverse()
  )

  const campaign_runs = $derived(
    (app.world.runs_by_campaign[entity_id] ?? [])
      .map((id) => campaign_run(app.world, entity_id, id))
      .filter((run) => run !== undefined)
      .reverse()
  )

  /**
   * How the experiment has been doing, counted over its history: the four
   * numbers a glance at the page is for. Failed is every run that ended
   * badly, `Error` included — the colour the history draws it in.
   */
  const stats = $derived.by(() => {
    const statuses =
      entity?.kind === 'Campaign'
        ? campaign_runs.map((run) => run.status)
        : job_runs.map((run) => run.status)
    return [
      { label: 'Runs', value: statuses.length, color: 'var(--strong-foreground)' },
      {
        label: 'Active',
        value: statuses.filter(is_active).length,
        color: tone_color('info')
      },
      {
        label: 'Succeeded',
        value: statuses.filter((status) => tone_of(status) === 'good').length,
        color: tone_color('good')
      },
      {
        label: 'Failed',
        value: statuses.filter((status) => tone_of(status) === 'bad').length,
        color: tone_color('bad')
      }
    ]
  })
</script>

{#if entity !== undefined}
  <!-- Top to bottom: what it is called, what it is for, where it is; then
       what it takes, as a table — name, shape, description — since a
       parameter is read before it is filled in (§13.1). No kind label: the
       tile's sign is the Explorer row's. Launch, the one primary and the
       action this page is opened for, sits at the head's right; Remove is
       at the foot. -->
  <header>
    <span class="tile" class:campaign={entity.kind === 'Campaign'} title={entity.kind}>
      <KindIcon kind={entity.kind} size={24} />
    </span>
    <div class="identity">
      <h1>{entity.name}</h1>
      {#if entity.description !== null}
        <p class="description">{entity.description}</p>
      {/if}
      <div class="path">
        <FolderIcon size={13} strokeWidth={1.75} aria-hidden="true" />
        <span class="mono">{entity.path}</span>
      </div>
    </div>
    <div class="actions">
      <Button
        class="start"
        disabled={blocking !== null}
        title={blocking ?? 'Launch'}
        onclick={() => navigate({ page: 'start', entity_id })}
      >
        <PlayIcon />Launch
      </Button>
    </div>
  </header>

  {#if blocking !== null}
    <div class="blocking" role="alert">
      <TriangleAlertIcon size={16} aria-hidden="true" />
      <span>{blocking}</span>
    </div>
  {/if}

  {#if stats[0].value > 0}
    <div class="stats">
      {#each stats as stat (stat.label)}
        <div class="stat panel">
          <span class="eyebrow">{stat.label}</span>
          <span class="value" style="color: {stat.value === 0 ? 'var(--description)' : stat.color}"
            >{stat.value}</span
          >
        </div>
      {/each}
    </div>
  {/if}

  {#if blocking === null}
    <h2 class="section-title">
      Parameters <span class="tally">{entity.parameters.length}</span>
    </h2>
    {#if entity.parameters.length === 0}
      <p class="none">No parameters.</p>
    {:else}
      <div class="panel specs-panel">
        <table class="specs">
          <thead>
            <tr><th>Name</th><th>Values</th><th>Description</th></tr>
          </thead>
          <tbody>
            {#each entity.parameters as spec (spec.name)}
              <tr>
                <td class="mono name">{spec.name}</td>
                <td class="shape">{describe_values(spec)}</td>
                <td>{spec.description}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}

  <h2 class="section-title">
    History <span class="tally">{stats[0].value}</span>
  </h2>
  {#if entity.kind === 'Job'}
    {#if job_runs.length === 0}
      <p class="none">No runs yet.</p>
    {:else}
      <div class="panel">
        <table class="runs">
          <!-- Sized for the widest value each column actually holds: the status
               dot, a run id, `120h 59m 59s`, `59 minutes ago`. Arguments is the
               one column with no bound — a sweep is what varies them — so it is
               the one left unsized and takes what is left, right after the id,
               since it is what tells runs apart (§22.2). -->
          <colgroup>
            <col style="width: 38px" />
            <col style="width: 54px" />
            <col />
            <col style="width: 100px" />
            <col style="width: 124px" />
            <col style="width: 96px" />
          </colgroup>
          <thead>
            <tr>
              <th aria-label="Status"></th><th class="num">Run</th><th class="over-params"
                >Arguments</th
              >
              <th>Duration</th><th>Started</th><th>By</th>
            </tr>
          </thead>
          <tbody>
            {#each job_runs as run (run.id)}
              <HistoryRow
                {entity_id}
                run_id={run.id}
                params={run.params}
                deletable={is_deletable(run) && !run.report_locked}
                route={{ page: 'job_run', job_id: entity_id, run_id: run.id }}
              >
                <td><StatusPill status={run.status} health={run.query_health} compact /></td>
                <td class="mono num">{run.id}</td>
                <td title={run.parameters}>
                  {#if run.parameters !== ''}<span class="mono params">{run.parameters}</span>{/if}
                </td>
                <td class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</td>
                <td title={format_started_at(run.started_at)}>
                  {format_relative(run.started_at, app.now_ms)}
                </td>
                <td title={origin_label(run.origin)}>{origin_label(run.origin)}</td>
              </HistoryRow>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if campaign_runs.length === 0}
    <p class="none">No runs yet.</p>
  {:else}
    <div class="panel">
      <table class="runs">
        <colgroup>
          <col style="width: 38px" />
          <col style="width: 54px" />
          <col />
          <col style="width: 100px" />
          <col style="width: 124px" />
          <col style="width: 96px" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Status"></th><th class="num">Run</th><th class="over-params"
              >Arguments</th
            >
            <th>Duration</th><th>Started</th><th>By</th>
          </tr>
        </thead>
        <tbody>
          {#each campaign_runs as run (run.id)}
            <HistoryRow
              {entity_id}
              run_id={run.id}
              params={run.params}
              deletable={is_terminal(run.status) && !run.report_locked}
              route={{ page: 'campaign_run', campaign_id: entity_id, run_id: run.id }}
            >
              <td><StatusPill status={run.status} health={run.query_health} compact /></td>
              <td class="mono num">{run.id}</td>
              <td title={run.parameters}>
                {#if run.parameters !== ''}<span class="mono params">{run.parameters}</span>{/if}
              </td>
              <td class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</td>
              <td title={format_started_at(run.started_at)}>
                {format_relative(run.started_at, app.now_ms)}
              </td>
              <td title={trigger_label(run.by)}>{trigger_label(run.by)}</td>
            </HistoryRow>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- At the foot, away from Launch: the one action here that takes
       something away is the one least often wanted, and a frequent button's
       neighbour gets clicked by mistake (§13.1). Red, and in words: an icon
       alone read as "open the folder". Removal leaves the folder on disk, so
       the sign is a minus, not a bin. It stays when the manifest is broken —
       a folder that cannot launch is exactly one someone may want out of the
       Explorer. -->
  <div class="removal">
    <p>
      Take this {entity.kind === 'Job' ? 'job' : 'campaign'} out of the Explorer. The folder, its runs
      and its reports stay on disk.
    </p>
    <Button
      variant="destructive"
      title="Remove from Explorer — the folder stays on disk"
      aria-label="Remove from Explorer"
      onclick={() => request_remove(entity_id)}
    >
      <CircleMinusIcon />Remove
    </Button>
  </div>
{/if}

<style>
  header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }

  /* The kind's sign on a wash of the kind's colour: the page's identity,
     the same sign as the Explorer row it was opened from. */
  .tile {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: color-mix(in srgb, var(--kind-job) 14%, transparent);
  }

  .tile.campaign {
    background: color-mix(in srgb, var(--kind-campaign) 14%, transparent);
  }

  .identity {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  /* A long description must not push the history off the first screen:
     three lines, then it scrolls inside itself. */
  .description {
    margin: 0;
    max-width: 640px;
    max-height: calc(3 * 1.45em);
    line-height: 1.45;
    overflow-y: auto;
    user-select: text;
  }

  /* The folder sign stays on the path's first line when a long path wraps. */
  .path {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: var(--description);
    user-select: text;
  }

  .path :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .path .mono {
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    padding-top: 2px;
  }

  /* Something the reader must notice: a bordered callout (ui-system.md). */
  .blocking {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--warning) 9%, transparent);
    color: var(--warning);
  }

  .blocking :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 20px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px 9px;
  }

  .value {
    font-size: 22px;
    line-height: 1.1;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  /* One row per parameter: its name, what may be put there, what it is
     for. Not a `.runs` table — nothing here is a row to click or a column
     that must not jitter — but it borrows the heading look, so the three
     columns are named and the last one is known to be the description.
     Name and type take their widest value, the description what is left. */
  .specs {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }

  /* Past five rows or so the list scrolls inside its panel, headings
     pinned, for the same reason the description stops at three lines: the
     history is what the page is opened for. */
  .specs-panel {
    max-height: 214px;
    overflow-y: auto;
  }

  .specs th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--widget-bg);
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--description);
    border-bottom: 1px solid var(--border);
    padding: 9px 24px 8px 0;
    white-space: nowrap;
  }

  .specs td {
    padding: 8px 24px 8px 0;
    vertical-align: top;
    border-bottom: 1px solid var(--border);
  }

  .specs tbody tr:last-child td {
    border-bottom: none;
  }

  .specs th:first-child,
  .specs td:first-child {
    padding-left: 14px;
  }

  .specs th:last-child,
  .specs td:last-child {
    width: 100%;
    padding-right: 14px;
  }

  .specs .name {
    color: var(--strong-foreground);
    font-weight: 600;
    white-space: nowrap;
  }

  .specs .shape {
    color: var(--description);
    white-space: nowrap;
  }

  .none {
    margin: 0;
    color: var(--description);
    font-style: italic;
  }

  .removal {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .removal p {
    flex: 1;
    margin: 0;
    color: var(--description);
  }
</style>
