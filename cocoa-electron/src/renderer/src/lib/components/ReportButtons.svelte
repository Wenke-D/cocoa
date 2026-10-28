<!--
  A run's Report row (§17.5): the report itself when it is short enough to
  be read in place, the way to open it when it is not, and the state in
  words when there is none.

  A report is `.txt`, `.html`, or both (convention §11), and the two are for
  different reading. The plain text is the quick answer — a verdict, a few
  numbers — so it is shown right here, read from `source`, held to a fixed
  height and scrolling inside past it: no extra page between the reader and
  a line. The HTML is the long analysis, so it is `Open`, to the report
  viewer (§20). Both: the text here and `Open` for the HTML.

  `error` is a failed run's report script failing (convention §7.3.1). It
  says so in place of the state, or under the buttons when the script left
  files behind before it failed.

  `attachments` is how many entries the report script left in its
  attachment directory (convention §7.3); when there are any, a button
  opens the directory in the system file manager.

  `visualize`, when the experiment has a `[visualize]` script and the run a
  report (convention §7.7), opens the script's viewer. It is busy only until
  the script has started, so one click opens one viewer.

  `save` saves a copy of the report, files and attachments, wherever the
  person picks: a copy that a later regenerate or delete leaves alone.

  `lock` locks and unlocks the report (convention §7.3.3), offered while
  there is a report to keep, and always while one is locked. Locked, the
  report is not regenerated and the run is not deleted, so `Regenerate` stays
  in the row, disabled, its tooltip saying why.

  `rerun`, when the run may have its report re-run by hand (convention
  §7.3.2), is the last action in the row. It is busy only until the engine
  answers: by then the report is due and the row reads `Generating`, with
  no button, until the outcome lands.
-->
<script lang="ts">
  import { report_summary } from '../../format'
  import type { ReportResult } from '@shared/protocol'
  import type { ReportState } from '@shared/world'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text'
  import ChartLineIcon from '@lucide/svelte/icons/chart-line'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import LockIcon from '@lucide/svelte/icons/lock'
  import LockOpenIcon from '@lucide/svelte/icons/lock-open'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import SaveIcon from '@lucide/svelte/icons/save'

  let {
    report,
    source,
    error = null,
    open_html,
    attachments = 0,
    open_attachments = null,
    visualize = null,
    save = null,
    lock = null,
    rerun = null
  }: {
    report: ReportState
    /** Whose report this is: the folder it is in, and the run. */
    source: { entity_id: string; run_id: string }
    error?: string | null
    open_html: () => void
    attachments?: number
    open_attachments?: (() => Promise<void>) | null
    visualize?: (() => Promise<void>) | null
    save?: (() => Promise<void>) | null
    lock?: { locked: boolean; toggle: () => Promise<void> } | null
    rerun?: (() => Promise<void>) | null
  } = $props()

  const locked = $derived(lock?.locked ?? false)

  const files = $derived(
    typeof report === 'object' && 'Available' in report ? report.Available.files : []
  )
  const html = $derived(files.some((file) => file.format === 'Html'))

  /**
   * What the plain text is read for, as one string: it changes only when
   * there is a different text to read. A world refresh hands the same report
   * over every tick, and a regenerate passes through `Generating`, where
   * this is `null`, so a new report is read again and an unchanged one is
   * not.
   */
  const text_key = $derived(
    files.some((file) => file.format === 'PlainText')
      ? `${source.entity_id}\n${source.run_id}`
      : null
  )

  /** The plain text once read, or why it could not be. */
  let text = $state<ReportResult | null>(null)
  const body = $derived(text !== null && text.ok ? text.text : '')

  $effect(() => {
    text = null
    if (text_key === null) {
      return
    }
    // Taken from the key, not from `source`, which is a fresh object
    // whenever the run is: the read follows the key alone.
    const [entity_id, run_id] = text_key.split('\n')
    let current = true
    void window.cocoa
      .report({ entity_id, run_id, format: 'PlainText' })
      .catch((cause: unknown): ReportResult => ({ ok: false, message: (cause as Error).message }))
      .then((result) => {
        if (current) {
          text = result
        }
      })
    return () => {
      current = false
    }
  })

  /** Held while the save dialog is open, so one click asks once. */
  let saving = $state(false)

  async function ask_save(): Promise<void> {
    if (save === null || saving) {
      return
    }
    saving = true
    try {
      await save()
    } finally {
      saving = false
    }
  }

  /** Held from the click until the engine has written the lock. */
  let locking = $state(false)

  async function ask_lock(): Promise<void> {
    if (lock === null || locking) {
      return
    }
    locking = true
    try {
      await lock.toggle()
    } finally {
      locking = false
    }
  }

  /** Held from the click to the answer; after that the world says `Generating`. */
  let asking = $state(false)

  async function ask_rerun(): Promise<void> {
    if (rerun === null || asking) {
      return
    }
    asking = true
    try {
      await rerun()
    } finally {
      asking = false
    }
  }

  /** Held from the click until the viewer has started. */
  let starting = $state(false)

  async function ask_visualize(): Promise<void> {
    if (visualize === null || starting) {
      return
    }
    starting = true
    try {
      await visualize()
    } finally {
      starting = false
    }
  }
</script>

{#if text_key !== null}
  {#if text === null}
    <p class="reading">Reading the report…</p>
  {:else if !text.ok}
    <p class="error">Unable to read the report: {text.message}</p>
  {:else if body.trim() === ''}
    <p class="reading">The plain-text report is empty.</p>
  {:else}
    <pre class="text" aria-label="Plain-text report">{body}</pre>
  {/if}
{/if}
<div class="row">
  {#if html}
    <Button variant="secondary" title="Open the HTML report" onclick={open_html}>
      <BookOpenTextIcon />Open
    </Button>
  {:else if files.length === 0 && error === null}
    <span>{report_summary(report)}</span>
  {/if}
  {#if attachments > 0 && open_attachments !== null}
    <Button
      variant="secondary"
      title="Open the {attachments} {attachments === 1
        ? 'item'
        : 'items'} the report attached in the file manager"
      onclick={open_attachments}
    >
      <FolderOpenIcon />Attachments
    </Button>
  {/if}
  {#if visualize !== null}
    <Button
      variant="secondary"
      title="Open this run's report in the experiment's viewer"
      disabled={starting}
      onclick={ask_visualize}
    >
      {#if starting}<Spinner />Opening…{:else}<ChartLineIcon />Visualize{/if}
    </Button>
  {/if}
  {#if save !== null}
    <Button
      variant="secondary"
      title="Save a copy of this report and its attachments to a folder you choose"
      disabled={saving}
      onclick={ask_save}
    >
      <SaveIcon />Save as…
    </Button>
  {/if}
  {#if lock !== null}
    <Button
      variant="secondary"
      aria-pressed={locked}
      title={locked
        ? 'Locked: the report is not regenerated and the run not deleted. Click to unlock.'
        : 'Lock the report: keep it from being regenerated, and the run from being deleted'}
      disabled={locking}
      onclick={ask_lock}
    >
      {#if locked}<LockIcon />Locked{:else}<LockOpenIcon />Lock{/if}
    </Button>
  {/if}
  {#if rerun !== null}
    <!-- A disabled button takes no pointer, so the span carries the why. -->
    <span title={locked ? 'The report is locked; unlock it to regenerate it' : undefined}>
      <Button
        variant="secondary"
        title="Run the report script again; its output replaces this report"
        disabled={asking || locked}
        onclick={ask_rerun}
      >
        {#if asking}<Spinner />Regenerating…{:else}<RotateCcwIcon />Regenerate{/if}
      </Button>
    </span>
  {/if}
</div>
{#if error !== null}
  <p class="error">Report script failed: {error}</p>
{/if}

<style>
  /* The quick answer, in place: as long as it is short, all of it; past
     about a dozen lines it scrolls inside itself, so a long text cannot
     push the rest of the page away. */
  .text {
    margin: 0 0 10px;
    padding: 10px 12px;
    max-height: 220px;
    overflow: auto;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--strong-foreground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .reading {
    margin: 0 0 10px;
    color: var(--description);
  }

  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .row:empty {
    display: none;
  }

  .error {
    margin: 8px 0 0;
    color: var(--error);
    white-space: pre-wrap;
    user-select: text;
  }
</style>
