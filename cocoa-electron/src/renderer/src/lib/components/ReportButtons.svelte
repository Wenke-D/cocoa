<!--
  A run's Report row (§17.5): the way to look at the report, and the state in
  words when there is none to look at.

  One file is one action, `View report`: which format it is does not matter
  to someone who wants to read it, so it is only the button's tooltip. Two
  files are a choice, and then the format is the point: a `Text` and an
  `HTML` button, each with the same view icon.
-->
<script lang="ts">
  import { format_label, report_summary } from '@shared/world'
  import type { ReportFormat, ReportState } from '@shared/world'
  import { Button } from '$lib/components/ui/button'
  import EyeIcon from '@lucide/svelte/icons/eye'

  let { report, open }: { report: ReportState; open: (format: ReportFormat) => void } = $props()

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
{:else}
  {report_summary(report)}
{/if}

<style>
  .buttons {
    display: flex;
    gap: 8px;
  }
</style>
