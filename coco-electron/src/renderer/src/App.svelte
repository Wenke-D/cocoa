<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from './ui_state'
  import { app, apply_events, bootstrap, dismiss_notice, flush_ui } from './state.svelte'
  import CancelModal from './lib/CancelModal.svelte'
  import ContextMenu from './lib/ContextMenu.svelte'
  import RemoveModal from './lib/RemoveModal.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import StatusBar from './lib/StatusBar.svelte'
  import Empty from './pages/Empty.svelte'
  import EntityOverview from './pages/EntityOverview.svelte'
  import StartRun from './pages/StartRun.svelte'
  import JobRunDetail from './pages/JobRunDetail.svelte'
  import BenchRunDetail from './pages/BenchRunDetail.svelte'
  import BenchChildRunDetail from './pages/BenchChildRunDetail.svelte'
  import ReportViewer from './pages/ReportViewer.svelte'

  let dragging = $state(false)

  // One key per distinct page identity, so navigation re-runs the enter
  // transition but a world refresh on the same page does not.
  const page_key = $derived(JSON.stringify(app.route))

  onMount(() => {
    // Subscribe first, then pull the starting state: an event batch landing
    // in between is applied to the empty world and then superseded by the
    // (newer) bootstrap. Order-safe in both interleavings.
    const unsubscribe = window.coco.on_events(apply_events)
    void bootstrap()
    // The arrangement leaves the page exactly once, on its way out — a
    // reload's unload included; the bootstrap that follows pulls it back.
    window.addEventListener('pagehide', flush_ui)
    const clock = setInterval(() => {
      app.now_ms = Date.now()
    }, 1000)
    return () => {
      unsubscribe()
      clearInterval(clock)
      window.removeEventListener('pagehide', flush_ui)
    }
  })

  // The drag listens on the window rather than on the handle, and does not
  // rely on pointer capture. The handle moves *with* the sidebar it is
  // resizing, so the moment the width lags the pointer — or capture is lost
  // for any of the reasons a browser may drop it — the pointer is over the
  // page instead and the drag stops halfway, at whatever width the last event
  // it saw happened to name.
  function start_drag(event: PointerEvent): void {
    event.preventDefault()
    dragging = true
    window.addEventListener('pointermove', drag)
    window.addEventListener('pointerup', end_drag)
    window.addEventListener('pointercancel', end_drag)
  }

  function drag(event: PointerEvent): void {
    if (!dragging) {
      return
    }
    app.sidebar_width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, event.clientX))
  }

  function end_drag(): void {
    dragging = false
    window.removeEventListener('pointermove', drag)
    window.removeEventListener('pointerup', end_drag)
    window.removeEventListener('pointercancel', end_drag)
  }
</script>

<div class="shell">
  <div class="content">
    <aside style="width: {app.sidebar_width}px">
      <Sidebar />
    </aside>
    <div
      class="divider"
      class:dragging
      role="separator"
      aria-orientation="vertical"
      onpointerdown={start_drag}
    ></div>
    <main>
      {#key page_key}
        <div class="page" in:fade={{ duration: 120 }}>
          {#if app.route.page === 'empty'}
            <Empty />
          {:else if app.route.page === 'entity'}
            <EntityOverview entity_id={app.route.entity_id} />
          {:else if app.route.page === 'start'}
            <StartRun entity_id={app.route.entity_id} />
          {:else if app.route.page === 'job_run'}
            <JobRunDetail job_id={app.route.job_id} run_id={app.route.run_id} />
          {:else if app.route.page === 'bench_run'}
            <BenchRunDetail bench_id={app.route.bench_id} run_id={app.route.run_id} />
          {:else if app.route.page === 'bench_child'}
            <BenchChildRunDetail
              bench_id={app.route.bench_id}
              bench_run_id={app.route.bench_run_id}
              run_id={app.route.run_id}
            />
          {:else if app.route.page === 'report'}
            <ReportViewer context={app.route.context} run_id={app.route.run_id} />
          {/if}
        </div>
      {/key}
    </main>
  </div>
  <StatusBar />

  {#if app.menu !== null}
    <ContextMenu menu={app.menu} />
  {/if}

  {#if app.overlay?.kind === 'confirm_cancel'}
    <CancelModal overlay={app.overlay} />
  {:else if app.overlay?.kind === 'confirm_remove'}
    <RemoveModal overlay={app.overlay} />
  {/if}

  {#if app.notice !== null}
    <div
      class="notice"
      class:error={app.notice.level === 'error'}
      role={app.notice.level === 'error' ? 'alert' : 'status'}
      transition:fade={{ duration: 150 }}
    >
      <span>{app.notice.text}</span>
      <!-- A failure does not fade, so it needs a way out (§8.5's Dismiss). -->
      {#if app.notice.level === 'error'}
        <button class="dismiss" onclick={dismiss_notice}>Dismiss</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .shell {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .content {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  aside {
    background: var(--side-bar-bg);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    flex-shrink: 0;
  }

  .divider {
    width: 4px;
    margin-left: -4px;
    cursor: col-resize;
    flex-shrink: 0;
    z-index: 1;
  }

  .divider:hover,
  .divider.dragging {
    background: var(--accent);
  }

  main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    background: var(--editor-bg);
  }

  .page {
    padding: 20px;
    max-width: 900px;
  }

  .notice {
    position: fixed;
    right: 16px;
    bottom: 34px;
    max-width: 520px;
    display: flex;
    align-items: baseline;
    gap: 12px;
    background: var(--widget-bg);
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    color: var(--strong-foreground);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .notice.error {
    border-left-color: var(--error);
  }

  .notice span {
    overflow-wrap: anywhere;
  }

  .dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .dismiss:hover {
    text-decoration: underline;
  }
</style>
