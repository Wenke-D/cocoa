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
//   runtime.ts        the engine, its queue, the notice gate
//   window.ts         the window: making it, sending to it, its geometry
//   window_state.ts   how the window was left, and when it is written back
//   publish.ts        the model, and turning its changes into events
//   refresh.ts        the tick
//   ipc.ts            what the renderer may ask for

import { app } from 'electron'
import type { WindowState } from './window_state'
import { restore_window_state, persist_window_state } from './window_state'
import type { AgentServer } from './agent'
import { serve, socket_path } from './agent'
import { build_menu } from './menu'
import * as operations from './operations'
import { announce, announce_when_heard, current_model, message_of, publish_cycle } from './publish'
import { REFRESH_INTERVAL_MS, refresh_and_publish } from './refresh'
import { engine, notices, on_engine } from './runtime'
import { register_ipc } from './ipc'
import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'
import { any_window_open, create_window, window_bounds } from './window'

/**
 * The agent interface (§43), if it can have the socket. A second window must
 * not steal the first one's — it would be a second owner of the same store —
 * so a refusal here leaves this window running without an interface, and says
 * so once.
 */
let agent: Maybe<AgentServer> = empty()

async function start_agent_interface(): Promise<void> {
  const file = socket_path()
  try {
    agent = some(
      await serve(file, {
        // Reads are answered from the model the window renders from, so they
        // never wait on the engine — at most one pass old, which is what a read
        // over a socket is anyway.
        world: current_model,
        // Writes take exactly the path a click takes: the same operation, the
        // same queue, the same publish. Only the trigger differs.
        start: (name, parameters) =>
          on_engine(async () => {
            const result = await operations.start_run(engine, name, parameters, 'agent')
            publish_cycle(empty())
            return result
          })
      })
    )
    console.log('agent interface listening on', file)
  } catch (error) {
    console.error('agent interface:', message_of(error))
    announce_when_heard(
      announce(notices.automatic(some(`Agent interface is off: ${message_of(error)}`)))
    )
  }
}

/** The window, opened the way it was left. */
function open_window(restored: WindowState): void {
  create_window(restored, () => persist_window_state(restored, window_bounds()))
}

// A drive run redirects everything the app keeps per-user — the window state
// file, the renderer's localStorage — so it never touches the real profile
// (`scripts/drive.mjs`). Before ready, or the default profile is already open.
const user_data_override = process.env.COCO_USER_DATA_DIR
if (user_data_override !== undefined && user_data_override !== '') {
  app.setPath('userData', user_data_override)
}

void app.whenReady().then(() => {
  // A hidden window still puts an icon in the dock and takes the focus with
  // it; the point of hiding it was not to. macOS only, and only under the
  // same flag (`window.ts`).
  if (process.env.COCO_HIDE_WINDOW === '1') {
    app.dock?.hide()
  }

  // only when app is ready, this returns a valid path
  const user_data_path = app.getPath('userData')

  // restore window state from last run
  const restored = restore_window_state(user_data_path)

  register_ipc()

  build_menu()

  open_window(restored)

  void refresh_and_publish()
  setInterval(() => void refresh_and_publish(), REFRESH_INTERVAL_MS)
  void start_agent_interface()

  app.on('activate', () => {
    if (!any_window_open()) {
      open_window(restored)
    }
  })

  // A launch script gets its grace period before the process exits (§10).
  let shutting_down = false
  app.on('will-quit', (event) => {
    // The second ending — the first is the window's close (`open_window`);
    // both persist the same record.
    persist_window_state(restored, window_bounds())
    // The socket file is this process's to remove; leaving it behind makes
    // the next launch decide whether a live coco owns it.
    if (agent.is_present()) {
      void agent.value.close()
    }
    agent = empty()
    if (shutting_down) {
      return
    }
    if (engine.launches_in_flight() === 0) {
      return
    }
    event.preventDefault()
    shutting_down = true
    void engine.shutdown_launches(5_000).then(() => app.quit())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
