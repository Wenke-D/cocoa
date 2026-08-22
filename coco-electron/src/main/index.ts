// The main process is the server side of the classic Electron shape: it owns
// the coco engine, runs the refresh loop that monitors jobs and benches, and
// emits changes to the UI and the AI. The renderer bootstraps once, then
// receives typed events.
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
//   log.ts            how the process prints
//   launch.ts         what this launch is: its profile, window, platform

import { app } from 'electron'
import { restore_window_state, persist_window_state } from './window_state'
import { serve, socket_path } from './agent/serve'
import * as operations from './operations'
import { current_world, message_of, publish_cycle } from './publish'
import { REFRESH_INTERVAL_MS, refresh_and_publish } from './refresh'
import { engine } from './runtime'
import { register_ipc } from './ipc'
import { launch } from './launch'
import { build_menu } from './menu'
import { empty } from '@shared/maybe'
import { create_window, focus_window, window_bounds } from './window'
import { AgentDeps } from './agent/answer'
import { log_for } from './log'

const log = log_for('index')

/**
 * Starts the agent server and settles its whole fate here, both ways: once
 * serving, quitting coco closes it — the ending is registered on the success
 * path, where the server exists; a refusal is logged and exits the app.
 * Either way the caller has nothing to hold and nothing to clean up.
 */
function start_agent_server(): void {
  const socket_file = socket_path()
  const agent_server_input: AgentDeps = {
    // Reads are answered from the model the window renders from, so they
    // never wait on the engine — at most one pass old, which is what a read
    // over a socket is anyway.
    current_world,
    // Writes take exactly the path a click takes: the same operation, the
    // same publish. Only the trigger differs.
    start: async (name, parameters) => {
      const result = await operations.start_run(engine, name, parameters, 'agent')
      publish_cycle(empty())
      return result
    }
  }

  serve(socket_file, agent_server_input).then(
    (server) => {
      log.info('agent interface listening on', socket_file)
      // Fire and forget: the process is leaving, and the close needs no
      // waiting to remove the socket file it owns.
      app.on('will-quit', () => void server.close())
    },
    (error: unknown) => {
      // If the agent interface fails to launch, coco crashes with it: an
      // internal error, not a state to keep running in. `serve` left nothing
      // behind — the file only appears once the bind succeeds.
      log.error('agent interface:', message_of(error))
      app.exit(1)
    }
  )
}

/** The window's whole launch sequence: the state its file kept — or the
 *  defaults when there is none — the window opened with it, and the geometry
 *  it actually got written back, at once and again by its close. The state
 *  stays in here: after launch, the window itself is the one to ask. */
function launch_window(user_data_dir: string): void {
  const restored = restore_window_state(user_data_dir)
  create_window(restored, () => persist_window_state(window_bounds()))
  persist_window_state(window_bounds())
}

/**
 * Whether this launch is the machine's one coco: the holder of the
 * single-instance lock.
 *
 * One coco instance per user machine, by design: coco monitors the
 * experiments the user launches, and a second instance is useless for that.
 */
const is_first_one = app.requestSingleInstanceLock()
if (is_first_one) {
  // The first instance hears about a second launch attempt, and should open
  // its window to the user who asked.
  app.on('second-instance', focus_window)
} else {
  // A subsequent launch just quits, directly. It registers no
  // `second-instance` handler — that event only ever reaches the lock's
  // holder.
  log.info('coco is already running; this launch quits, and the running one comes to the front')
  app.quit()
}

void app.whenReady().then(() => {
  // `quit()` on a subsequent launch still lets `ready` fire on the way out;
  // this guard keeps such a launch from doing anything with it.
  if (!is_first_one) {
    return
  }

  // A hidden window still puts an icon in the dock and takes the focus with
  // it; the point of hiding it was not to. The platform is a fact of the
  // launch, not a probe of `dock` — the `?.` is only what its type asks for,
  // the property being declared for macOS alone.
  if (launch.hide_window && launch.is_mac) {
    app.dock?.hide()
  }

  register_ipc()

  build_menu()

  launch_window(launch.user_data)

  void refresh_and_publish()
  setInterval(() => void refresh_and_publish(), REFRESH_INTERVAL_MS)

  start_agent_server()

  app.on('will-quit', () => {
    engine.abandon_launches()
  })
})

/**
 * Quits when the last window closes. Coco has no reason to run behind the
 * scenes, so macOS's stay-in-the-dock convention means nothing here.
 */
app.on('window-all-closed', () => {
  app.quit()
})
