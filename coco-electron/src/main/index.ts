// The main process is the server side of the classic Electron shape: it owns
// the coco engine, runs the refresh
// loop, monitoring jobs/benches, and emit changes to UI and AI.
// The renderer bootstraps
// once, then receives typed events.
//
// This file is the process's lifetime and nothing else: what happens when the
// app is ready, and what has to finish before it may quit. Each piece of state
// lives with the module that owns it —
//
//   runtime.ts      the engine, its queue, the notice gate
//   window.ts       the window: making it, sending to it, its geometry
//   arrangement.ts  where the user was, and writing it back
//   publish.ts      the model, and turning its changes into events
//   refresh.ts      the tick
//   ipc.ts          what the renderer may ask for

import { app } from 'electron'
import { arrangement, loadArrangement, persistUiState, persistUiStateNow } from './arrangement'
import type { AgentServer } from './agent'
import { serve, socketPath } from './agent'
import { buildMenu } from './menu'
import * as operations from './operations'
import { announce, announceWhenHeard, currentModel, messageOf, publishCycle } from './publish'
import { REFRESH_INTERVAL_MS, refreshAndPublish } from './refresh'
import { engine, notices, onEngine } from './runtime'
import { registerIpc } from './ipc'
import type { Maybe } from './types'
import { anyWindowOpen, createWindow } from './window'

/**
 * The agent interface (§43), if it can have the socket. A second window must
 * not steal the first one's — it would be a second owner of the same store —
 * so a refusal here leaves this window running without an interface, and says
 * so once.
 */
let agent: Maybe<AgentServer> = null

async function startAgentInterface(): Promise<void> {
  const file = socketPath()
  try {
    agent = await serve(file, {
      // Reads are answered from the model the window renders from, so they
      // never wait on the engine — at most one pass old, which is what a read
      // over a socket is anyway.
      world: currentModel,
      // Writes take exactly the path a click takes: the same operation, the
      // same queue, the same publish. Only the trigger differs.
      start: (name, parameters) =>
        onEngine(async () => {
          const result = await operations.startRun(engine, name, parameters, 'agent')
          publishCycle(null)
          return result
        })
    })
    console.log('agent interface listening on', file)
  } catch (error) {
    console.error('agent interface:', messageOf(error))
    announceWhenHeard(announce(notices.automatic(`Agent interface is off: ${messageOf(error)}`)))
  }
}

/** The window, opened the way it was left. */
function openWindow(): void {
  createWindow(arrangement().window, {
    onGeometryChanged: persistUiState,
    onClosing: persistUiStateNow
  })
}

void app.whenReady().then(() => {
  // A hidden window still puts an icon in the dock and takes the focus with
  // it; the point of hiding it was not to. macOS only, and only under the
  // same flag (`window.ts`).
  if (process.env.COCO_HIDE_WINDOW === '1') app.dock?.hide()

  // Read once, here: `userData` has no answer before the app is ready.
  loadArrangement(app.getPath('userData'))
  registerIpc()
  buildMenu()
  openWindow()
  void refreshAndPublish()
  setInterval(() => void refreshAndPublish(), REFRESH_INTERVAL_MS)
  void startAgentInterface()

  app.on('activate', () => {
    if (!anyWindowOpen()) openWindow()
  })
})

// A launch script gets its grace period before the process exits (§10).
let shuttingDown = false
app.on('will-quit', (event) => {
  persistUiStateNow()
  // The socket file is this process's to remove; leaving it behind makes the
  // next launch decide whether a live coco owns it.
  void agent?.close()
  agent = null
  if (shuttingDown) return
  if (engine.launchesInFlight() === 0) return
  event.preventDefault()
  shuttingDown = true
  void engine.shutdownLaunches(5_000).then(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
