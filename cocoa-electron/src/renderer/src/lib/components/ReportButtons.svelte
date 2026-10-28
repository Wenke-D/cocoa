<!--
  A run's Report row (§17.5): the way to look at the report, and the state in
  words when there is none to look at.

  One file is one action, `View`: which format it is does not matter to
  someone who wants to read it, so it is only the button's tooltip. Two
  files are a choice, and then the format is the point: a `Text` and an
  `HTML` button, each with the same view icon.

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
  import { format_label, report_summary } from '../../format'
  import type { ReportFormat, ReportState } from '@shared/world'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import EyeIcon from '@lucide/svelte/icons/eye'
  import ChartLineIcon from '@lucide/svelte/icons/chart-line'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import LockIcon from '@lucide/svelte/icons/lock'
  import LockOpenIcon from '@lucide/svelte/icons/lock-open'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import SaveIcon from '@lucide/svelte/icons/save'

  let {
    report,
    error = null,
    open,
    attachments = 0,
    open_attachments = null,
    visualize = null,
    save = null,
    lock = null,
    rerun = null
  }: {
    report: ReportState
    error?: string | null
    open: (format: ReportFormat) => void
    attachments?: number
    open_attachments?: (() => Promise<void>) | null
    visualize?: (() => Promise<void>) | null
    save?: (() => Promise<void>) | null
    lock?: { locked: boolean; toggle: () => Promise<void> } | null
    rerun?: (() => Promise<void>) | null
  } = $props()

  const locked = $derived(lock?.locked ?? false)

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

  /** The name a choice between formats goes by: short, since the icon says "view". */
  function choice_label(format: ReportFormat): string {
    return format === 'Html' ? 'HTML' : 'Text'
  }
</script>

<div class="row">
  {#if typeof report === 'object' && 'Available' in report}
    {@const files = report.Available.files}
    {#if files.length === 1}
      <Button
        variant="secondary"
        title="{format_label(files[0].format)} report"
        onclick={() => open(files[0].format)}
      >
        <EyeIcon />View
      </Button>
    {:else}
      {#each files as file (file.format)}
        <Button
          variant="secondary"
          title="{format_label(file.format)} report"
          onclick={() => open(file.format)}
        >
          <EyeIcon />{choice_label(file.format)}
        </Button>
      {/each}
    {/if}
  {:else if error === null}
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
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .error {
    margin: 8px 0 0;
    color: var(--error);
    white-space: pre-wrap;
    user-select: text;
  }
</style>
