<!--
  The report viewer (specification §20), opened in the full main-content area.
  Two formats, and coco controls neither their content nor their styling.

  Where §20 hands HTML to the system browser, this renders it in-app: that
  rule's reason is that a browser engine cannot be embedded, which is the one
  constraint this form does not have. The source stays one click away, so
  search and copy work on HTML too (§20.5).
-->
<script lang="ts">
  import type { ReportFormat } from '@shared/world'
  import type { Crumb } from '@shared/ui'
  import { app, context_entity_id, entity_of, notify, report_owner_id } from '../state.svelte'
  import type { ReportContext } from '../state.svelte'
  import Breadcrumbs from '../lib/Breadcrumbs.svelte'

  let { context, run_id }: { context: ReportContext; run_id: string } = $props()

  const entity_id = $derived(context_entity_id(context))
  const entity = $derived(entity_of(entity_id))
  /** The folder the file is in, which for a dispatched run is the job's. */
  const owner_id = $derived(report_owner_id(context, run_id))

  /**
   * The trail a report is read under is the trail of the page it was opened
   * from — the same run reached through a bench keeps the bench's, including
   * the bench run in between (§20.1, §2.3.1).
   */
  const crumbs = $derived.by<Crumb[]>(() => {
    const trail: Crumb[] = [
      { label: entity?.name ?? '(removed)', route: { page: 'entity', entity_id } }
    ]
    if (context.kind === 'bench_child') {
      trail.push({
        label: context.bench_run_id,
        route: { page: 'bench_run', bench_id: context.bench_id, run_id: context.bench_run_id },
        mono: true
      })
      trail.push({
        label: run_id,
        route: {
          page: 'bench_child',
          bench_id: context.bench_id,
          bench_run_id: context.bench_run_id,
          run_id
        },
        mono: true
      })
    } else {
      trail.push({
        label: run_id,
        route:
          context.kind === 'job_run'
            ? { page: 'job_run', job_id: context.job_id, run_id }
            : { page: 'bench_run', bench_id: context.bench_id, run_id },
        mono: true
      })
    }
    trail.push({ label: 'Report', route: null })
    return trail
  })

  let loading = $state(true)
  let error = $state<string | null>(null)
  let format = $state<ReportFormat>('PlainText')
  let text = $state('')

  let show_source = $state(false)
  let query = $state('')
  let current = $state(0)

  // Reading is by run, and a run's report does not change under the viewer:
  // it is read once, when the address is opened.
  $effect(() => {
    const target = { entity_id: owner_id, run_id }
    loading = true
    void window.coco.report(target).then((result) => {
      loading = false
      if (result.ok) {
        format = result.format
        text = result.text
        error = null
      } else {
        error = result.message
      }
    })
  })

  const lines = $derived(text.split('\n'))

  /**
   * Every occurrence, not every line that has one: two matches on one line
   * are two matches (§20.2 — counting is the part that must work).
   * Case-insensitive by default.
   */
  const matches = $derived.by(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return []
    const found: { line: number; at: number }[] = []
    lines.forEach((line, index) => {
      const haystack = line.toLowerCase()
      let at = haystack.indexOf(needle)
      while (at >= 0) {
        found.push({ line: index, at })
        at = haystack.indexOf(needle, at + needle.length)
      }
    })
    return found
  })

  /** Which lines to split for highlighting — the rest render untouched, so a
   * long report only pays for the lines that actually matched. */
  const matched_lines = $derived(new Set(matches.map((match) => match.line)))

  $effect(() => {
    if (current >= matches.length) current = 0
  })

  /** One line cut into alternating plain and matching pieces. */
  function pieces(line: string): { text: string; at: number }[] {
    const needle = query.trim()
    const haystack = line.toLowerCase()
    const lowered = needle.toLowerCase()
    const out: { text: string; at: number }[] = []
    let from = 0
    let at = haystack.indexOf(lowered)
    while (at >= 0) {
      if (at > from) out.push({ text: line.slice(from, at), at: -1 })
      out.push({ text: line.slice(at, at + needle.length), at })
      from = at + needle.length
      at = haystack.indexOf(lowered, from)
    }
    if (from < line.length) out.push({ text: line.slice(from), at: -1 })
    return out
  }

  function step(delta: number): void {
    if (matches.length === 0) return
    current = (current + delta + matches.length) % matches.length
    document
      .querySelector(`[data-line="${matches[current].line}"]`)
      ?.scrollIntoView({ block: 'center' })
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text)
    notify('Report copied.')
  }

  const show_rendered = $derived(format === 'Html' && !show_source)
</script>

<Breadcrumbs {crumbs} />

<header>
  <h1>Report <span class="mono run">{run_id}</span></h1>
  <span class="format">{format === 'Html' ? 'HTML' : 'Plain text'}</span>
  <div class="tools">
    {#if format === 'Html'}
      <button class="secondary" onclick={() => (show_source = !show_source)}>
        {show_source ? 'Rendered' : 'Source'}
      </button>
    {/if}
    {#if !show_rendered}
      <label class="toggle">
        <input type="checkbox" bind:checked={app.report_wrap} />
        Wrap lines
      </label>
    {/if}
    <button class="secondary" onclick={copy} disabled={text === ''}>Copy</button>
  </div>
</header>

{#if !show_rendered && error === null && !loading}
  <div class="search">
    <input type="search" placeholder="Search" bind:value={query} />
    <span class="count">
      {#if query.trim() === ''}
        &nbsp;
      {:else if matches.length === 0}
        No matches
      {:else}
        {current + 1} of {matches.length}
      {/if}
    </span>
    <button class="secondary" onclick={() => step(-1)} disabled={matches.length === 0}>
      Previous
    </button>
    <button class="secondary" onclick={() => step(1)} disabled={matches.length === 0}>Next</button>
  </div>
{/if}

{#if loading}
  <p class="none">Reading the report…</p>
{:else if error !== null}
  <p class="error">{error}</p>
{:else if show_rendered}
  <!--
    The report is written by an experiment script and is not trusted. The
    sandbox carries `allow-scripts` so charting reports work, and deliberately
    NOT `allow-same-origin` — the two together would let the frame remove its
    own sandbox. Without it the frame is an opaque origin that cannot reach
    this page. `nodeIntegrationInSubFrames` stays off, so no preload runs here
    and `window.coco` is unreachable from a report.
  -->
  <iframe class="rendered" title="Report {run_id}" sandbox="allow-scripts" srcdoc={text}></iframe>
{:else}
  <pre class="body" class:wrap={app.report_wrap}>{#each lines as line, index (index)}<span
        class="line"
        data-line={index}
        >{#if matched_lines.has(index)}{#each pieces(line) as piece, part (part)}{#if piece.at < 0}{piece.text}{:else}<mark
                class:current={matches[current]?.line === index &&
                  matches[current]?.at === piece.at}>{piece.text}</mark
              >{/if}{/each}{:else}{line}{/if}</span
      >{/each}</pre>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--strong-foreground);
  }

  .run {
    color: var(--description);
    font-weight: 400;
  }

  .format {
    color: var(--description);
  }

  .tools {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--description);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .search input {
    width: 240px;
    height: 26px;
    padding: 0 8px;
    background: var(--input-bg);
    color: var(--strong-foreground);
    border: 1px solid var(--control-border);
    border-radius: 3px;
  }

  .search input:focus {
    outline: 1px solid var(--accent);
  }

  .count {
    color: var(--description);
    min-width: 90px;
  }

  /* Toolbar buttons sit tighter than the app's default. */
  .secondary {
    padding: 4px 10px;
  }

  .body {
    margin: 0;
    padding: 12px;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    max-height: calc(100vh - 220px);
    overflow: auto;
    user-select: text;
    font-size: 12px;
    line-height: 1.5;
  }

  .line {
    display: block;
    white-space: pre;
  }

  /* Wrapping is off by default (§20.3): with it off every row is the same
     height, which is what keeps a long report cheap to lay out. */
  .body.wrap .line {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .line:empty::after {
    content: ' ';
  }

  mark {
    background: var(--search-match);
    color: inherit;
    border-radius: 2px;
  }

  mark.current {
    background: var(--search-match-current);
  }

  .rendered {
    width: 100%;
    height: calc(100vh - 190px);
    border: 1px solid var(--border);
    border-radius: 3px;
    background: #ffffff;
  }

  .error {
    padding: 10px 12px;
    border: 1px solid var(--error);
    border-radius: 3px;
    color: var(--error);
  }

  .none {
    color: var(--description);
    font-style: italic;
  }
</style>
