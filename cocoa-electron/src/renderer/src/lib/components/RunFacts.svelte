<!--
  The facts of one job run, rendered identically wherever that run is seen.

  A run dispatched by a campaign has two addresses (§2.3.1) and this is the part
  that must not differ between them: §19 says the two pages "must present
  identical facts", and the only way to be sure of that is for there to be one
  of them. What differs — breadcrumbs, which Explorer row stays selected, the
  report's context, and the rows a campaign adds in front — is passed in.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    deploy_summary,
    format_duration,
    format_relative,
    format_started_at,
    origin_label,
    query_available
  } from '../../format'
  import type { JobRun, ReportFormat } from '@shared/world'
  import type { ReportContext } from '../../route'
  import {
    lock_report,
    open_attachments,
    rerun_report,
    save_report,
    visualize
  } from '../../commands'
  import { navigate } from '../../navigation'
  import { app } from '../../state.svelte'
  import ReportButtons from './ReportButtons.svelte'
  import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark'

  let {
    run,
    report_context,
    leading
  }: { run: JobRun; report_context: ReportContext; leading?: Snippet } = $props()
</script>

<dl class="facts panel">
  {@render leading?.()}
  <div class="fact">
    <dt>Started by</dt>
    <dd>{origin_label(run.origin)}</dd>
  </div>
  <div class="fact">
    <dt>Started at</dt>
    <dd>{format_started_at(run.started_at)}</dd>
  </div>
  <div class="fact">
    <dt>Duration</dt>
    <dd class="mono">{format_duration(run.started_at, run.ended_at, app.now_ms)}</dd>
  </div>
  <div class="fact">
    <dt>Arguments</dt>
    <dd><span class="mono params">{run.parameters === '' ? '(none)' : run.parameters}</span></dd>
  </div>
  {#if run.deploy !== null}
    <div class="fact">
      <dt>Deploy</dt>
      <!-- The check's reason says why a deploy was needed. Printed beside the
           outcome it reads as one ("Deployed … nothing deployed yet"), so it
           sits behind a question mark, labelled as the why. An up-to-date
           check needed no deploy, and has no why to give. -->
      <dd>
        {deploy_summary(run.deploy)}
        {#if run.deploy.check === 'STALE' && run.deploy.reason !== null}
          <span
            class="why"
            role="img"
            title="Why: {run.deploy.reason}"
            aria-label="Why: {run.deploy.reason}"
          >
            <CircleQuestionMarkIcon />
          </span>
        {/if}
      </dd>
    </div>
  {/if}
  <div class="fact">
    <dt>Report</dt>
    <dd>
      <ReportButtons
        report={run.report}
        error={run.report_error}
        open={(format: ReportFormat) =>
          navigate({ page: 'report', context: report_context, run_id: run.id, format })}
        attachments={run.attachments}
        open_attachments={() => open_attachments({ entity_id: run.job_id, run_id: run.id })}
        visualize={run.visualizable
          ? () => visualize({ entity_id: run.job_id, run_id: run.id })
          : null}
        save={typeof run.report === 'object' && 'Available' in run.report
          ? () => save_report({ entity_id: run.job_id, run_id: run.id })
          : null}
        lock={(typeof run.report === 'object' && 'Available' in run.report) || run.report_locked
          ? {
              locked: run.report_locked,
              toggle: () =>
                lock_report({ entity_id: run.job_id, run_id: run.id, locked: !run.report_locked })
            }
          : null}
        rerun={run.report_rerunnable
          ? () => rerun_report({ entity_id: run.job_id, run_id: run.id })
          : null}
      />
    </dd>
  </div>
  {#if !query_available(run.query_health)}
    <div class="fact">
      <dt>Query</dt>
      <dd class="warning">
        Status is unknown — last successful query {format_relative(
          run.last_successful_query,
          app.now_ms
        )}. Last known status: {run.status}.
      </dd>
    </div>
  {/if}
  {#if run.error !== null}
    <div class="fact">
      <dt>Error</dt>
      <dd class="error">{run.error}</dd>
    </div>
  {/if}
</dl>

<style>
  /* The layout is `dl.facts` in theme.css, shared with the campaign run's. */

  .warning {
    color: var(--warning);
  }

  /* What the check said beside its word: the folder's words, not cocoa's. */
  .why {
    display: inline-flex;
    vertical-align: -2px;
    margin-left: 4px;
    color: var(--description);
    cursor: help;
  }

  .why :global(svg) {
    width: 14px;
    height: 14px;
  }

  .error {
    color: var(--error);
    user-select: text;
  }

  dl :global(.job-link) {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--link);
    cursor: pointer;
  }

  dl :global(.job-link:hover) {
    text-decoration: underline;
  }
</style>
