<!--
  A run's Report row: one Open button per report file it wrote (§20) — text,
  HTML, or both — and the state in words when there is none to open. The
  format is the button's label, so the row needs no sentence about it.
-->
<script lang="ts">
  import { format_label, report_summary } from '@shared/world'
  import type { ReportFormat, ReportState } from '@shared/world'
  import { Button } from '$lib/components/ui/button'

  let { report, open }: { report: ReportState; open: (format: ReportFormat) => void } = $props()
</script>

{#if typeof report === 'object' && 'Available' in report}
  <div class="buttons">
    {#each report.Available.files as file (file.format)}
      <Button variant="secondary" size="sm" onclick={() => open(file.format)}>
        {format_label(file.format)}
      </Button>
    {/each}
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
