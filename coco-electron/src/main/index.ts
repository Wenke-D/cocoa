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
//   ui_state.ts     where the user was, and when it is written back
//   publish.ts      the model, and turning its changes into events
//   refresh.ts      the tick
//   ipc.ts          what the renderer may ask for

import { app } from 'electron'
import { ui_state, load_ui_state, persist_ui_state, persist_ui_state_now } from './ui_state'
import type { AgentServer } from './agent'
import { serve, socket_path } from './agent'
import { build_menu } from './menu'
import * as operations from './operations'
import { announce, announce_when_heard, current_model, message_of, publish_cycle } from './publish'
import { REFRESH_INTERVAL_MS, refresh_and_publish } from './refresh'
import { engine, notices, on_engine } from './runtime'
import { register_ipc } from './ipc'
import type { Maybe } from './types'
import { any_window_open, create_window } from './window'

/**
 * The agent interface (§43), if it can have the socket. A second window must
 * not steal the first one's — it would be a second owner of the same store —
 * so a refusal here leaves this window running without an interface, and says
 * so once.
 */
let agent: Maybe<AgentServer> = null

async function start_agent_interface(): Promise<void> {
  const file = socket_path()
  try {
    agent = await serve(file, {
      // Reads are answered from the model the window renders from, so they
      // never wait on the engine — at most one pass old, which is what a read
      // over a socket is anyway.
      world: current_model,
      // Writes take exactly the path a click takes: the same operation, the
      // same queue, the same publish. Only the trigger differs.
      start: (name, parameters) =>
        on_engine(async () => {
          const result = await operations.start_run(engine, name, parameters, 'agent')
          publish_cycle(null)
          return result
        })
    })
    console.log('agent interface listening on', file)
  } catch (error) {
    console.error('agent interface:', message_of(error))
    announce_when_heard(announce(notices.automatic(`Agent interface is off: ${message_of(error)}`)))
  }
}

/** The window, opened the way it was left. */
function open_window(): void {
  create_window(ui_state().window, {
    on_geometry_changed: persist_ui_state,
    on_closing: persist_ui_state_now
  })
}

void app.whenReady().then(() => {
  // A hidden window still puts an icon in the dock and takes the focus with
  // it; the point of hiding it was not to. macOS only, and only under the
  // same flag (`window.ts`).
  if (process.env.COCO_HIDE_WINDOW === '1') {
    app.dock?.hide()
  }

  // Read once, here: `userData` has no answer before the app is ready.
  load_ui_state(app.getPath('userData'))

  register_ipc()
  build_menu()
  open_window()
  void refresh_and_publish()
  setInterval(() => void refresh_and_publish(), REFRESH_INTERVAL_MS)
  void start_agent_interface()

  app.on('activate', () => {
    if (!any_window_open()) open_window()
  })
})

// A launch script gets its grace period before the process exits (§10).
let shutting_down = false
app.on('will-quit', (event) => {
  persist_ui_state_now()
  // The socket file is this process's to remove; leaving it behind makes the
  // next launch decide whether a live coco owns it.
  void agent?.close()
  agent = null
  if (shutting_down) return
  if (engine.launches_in_flight() === 0) return
  event.preventDefault()
  shutting_down = true
  void engine.shutdown_launches(5_000).then(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
