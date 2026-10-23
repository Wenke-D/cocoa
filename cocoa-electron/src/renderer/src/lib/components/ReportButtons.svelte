<!--
  A run's Report row (§17.5): the way to look at the report, and the state in
  words when there is none to look at.

  One file is one action, `View report`: which format it is does not matter
  to someone who wants to read it, so it is only the button's tooltip. Two
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
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'

  let {
    report,
    error = null,
    open,
    attachments = 0,
    open_attachments = null,
    visualize = null,
    rerun = null
  }: {
    report: ReportState
    error?: string | null
    open: (format: ReportFormat) => void
    attachments?: number
    open_attachments?: (() => Promise<void>) | null
    visualize?: (() => Promise<void>) | null
    rerun?: (() => Promise<void>) | null
  } = $props()

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
        <EyeIcon />View report
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
  {#if rerun !== null}
    <Button
      variant="secondary"
      title="Run the report script again; its output replaces this report"
      disabled={asking}
      onclick={ask_rerun}
    >
      {#if asking}<Spinner />Re-running…{:else}<RotateCcwIcon />Re-run report{/if}
    </Button>
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
