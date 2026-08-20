<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@shared/ui'
  import {
    addFolder,
    app,
    applyEvents,
    bootstrap,
    dismissNotice,
    persistUi,
    refreshNow
  } from './state.svelte'
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

  // The arrangement is written back whenever it moves. An effect rather than a
  // call in `navigate()`, because the route also changes on its own — through
  // `recover()`, through a start landing on its new run — and being put back
  // on the Explorer is exactly the state worth remembering.
  $effect(() => {
    JSON.stringify(app.route)
    void app.sidebarWidth
    void app.reportWrap
    persistUi()
  })

  // One key per distinct page identity, so navigation re-runs the enter
  // transition but a world refresh on the same page does not.
  const pageKey = $derived(JSON.stringify(app.route))

  onMount(() => {
    // Subscribe first, then pull the starting state: an event batch landing
    // in between is applied to the empty world and then superseded by the
    // (newer) bootstrap. Order-safe in both interleavings.
    const unsubscribe = window.coco.onEvents(applyEvents)
    // A menu item runs exactly what the button runs.
    const unlisten = window.coco.onCommand((command) => {
      if (command === 'addFolder') void addFolder()
      else if (command === 'refresh') void refreshNow()
    })
    void bootstrap()
    const clock = setInterval(() => {
      app.nowMs = Date.now()
    }, 1000)
    return () => {
      unsubscribe()
      unlisten()
      clearInterval(clock)
    }
  })

  // The drag listens on the window rather than on the handle, and does not
  // rely on pointer capture. The handle moves *with* the sidebar it is
  // resizing, so the moment the width lags the pointer — or capture is lost
  // for any of the reasons a browser may drop it — the pointer is over the
  // page instead and the drag stops halfway, at whatever width the last event
  // it saw happened to name.
  function startDrag(event: PointerEvent): void {
    event.preventDefault()
    dragging = true
    window.addEventListener('pointermove', drag)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  function drag(event: PointerEvent): void {
    if (!dragging) return
    app.sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, event.clientX))
  }

  function endDrag(): void {
    dragging = false
    window.removeEventListener('pointermove', drag)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }
</script>

<div class="shell">
  <div class="content">
    <aside style="width: {app.sidebarWidth}px">
      <Sidebar />
    </aside>
    <div
      class="divider"
      class:dragging
      role="separator"
      aria-orientation="vertical"
      onpointerdown={startDrag}
    ></div>
    <main>
      {#key pageKey}
        <div class="page" in:fade={{ duration: 120 }}>
          {#if app.route.page === 'empty'}
            <Empty />
          {:else if app.route.page === 'entity'}
            <EntityOverview entityId={app.route.entityId} />
          {:else if app.route.page === 'start'}
            <StartRun entityId={app.route.entityId} />
          {:else if app.route.page === 'jobRun'}
            <JobRunDetail jobId={app.route.jobId} runId={app.route.runId} />
          {:else if app.route.page === 'benchRun'}
            <BenchRunDetail benchId={app.route.benchId} runId={app.route.runId} />
          {:else if app.route.page === 'benchChild'}
            <BenchChildRunDetail
              benchId={app.route.benchId}
              benchRunId={app.route.benchRunId}
              runId={app.route.runId}
            />
          {:else if app.route.page === 'report'}
            <ReportViewer context={app.route.context} runId={app.route.runId} />
          {/if}
        </div>
      {/key}
    </main>
  </div>
  <StatusBar />

  {#if app.menu !== null}
    <ContextMenu menu={app.menu} />
  {/if}

  {#if app.overlay?.kind === 'confirmCancel'}
    <CancelModal overlay={app.overlay} />
  {:else if app.overlay?.kind === 'confirmRemove'}
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
        <button class="dismiss" onclick={dismissNotice}>Dismiss</button>
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
