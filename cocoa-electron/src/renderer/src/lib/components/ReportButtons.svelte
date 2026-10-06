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
-->
<script lang="ts">
  import { format_label, report_summary } from '@shared/world'
  import type { ReportFormat, ReportState } from '@shared/world'
  import { Button } from '$lib/components/ui/button'
  import EyeIcon from '@lucide/svelte/icons/eye'

  let {
    report,
    error = null,
    open
  }: { report: ReportState; error?: string | null; open: (format: ReportFormat) => void } = $props()

  /** The name a choice between formats goes by: short, since the icon says "view". */
  function choice_label(format: ReportFormat): string {
    return format === 'Html' ? 'HTML' : 'Text'
  }
</script>

{#if typeof report === 'object' && 'Available' in report}
  {@const files = report.Available.files}
  <div class="buttons">
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
  </div>
{:else if error === null}
  {report_summary(report)}
{/if}
{#if error !== null}
  <p class="error">Report script failed: {error}</p>
{/if}

<style>
  .buttons {
    display: flex;
    gap: 8px;
  }

  .error {
    margin: 0;
    color: var(--error);
    white-space: pre-wrap;
    user-select: text;
  }

  .buttons + .error {
    margin-top: 8px;
  }
</style>
