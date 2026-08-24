// Drives the built app with Playwright over Electron's own binary, so a
// change can be seen working rather than only compiling. Headless CI is not
// the point: this is the "click it and look" path.
//
//   npm run build
//   npm run drive scripts/scenarios/cancel.mjs
//
// A scenario is a module exporting `run({ page, app, shot, log, wait_text })`.
// The app is launched against a scratch store (COCO_STORE_PATH), never the
// user's real one — the two cocos must not share a run-id counter.

import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(APP_DIR, '..')
const RUN_DIR = process.env.DRIVE_DIR ?? path.join(APP_DIR, '.drive')
const SHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join(RUN_DIR, 'shots')
const STORE_PATH = process.env.COCO_STORE_PATH ?? path.join(RUN_DIR, 'store.json')
// Everything the app keeps per-user — the window-state file, the renderer's
// localStorage — also gets a scratch home: a drive run must not decide where
// the user's real app opens, nor start on whatever page a real session left.
const USER_DATA_DIR = process.env.COCO_USER_DATA_DIR ?? path.join(RUN_DIR, 'user-data')
const WINDOW_STATE_PATH = path.join(USER_DATA_DIR, 'window-state.json')
// Likewise the agent socket (§43): a drive run must not take the socket a real
// coco is answering on, nor leave its own behind in the real place.
const SOCKET_PATH = process.env.COCO_SOCKET_PATH ?? path.join(RUN_DIR, 'coco.sock')

/**
 * A private copy of the bundled library, registered in a store of its own.
 * Never the real one: the two cocos share `~/.local/share/coco/store.json`
 * and would race its run-id counter, and a drive run starts real (mock) runs.
 *
 * `seed` says what the store holds at launch: everything (default),
 * `'library-only'` for nothing registered, or an array of folder names
 * relative to the library for a scenario that wants exactly those.
 */
function seed_library(seed) {
  const library = path.join(RUN_DIR, 'examples')
  fs.rmSync(library, { recursive: true, force: true })
  fs.cpSync(path.join(REPO_ROOT, 'examples'), library, { recursive: true })

  const folders = []
  for (const group of ['jobs', 'benches']) {
    const dir = path.join(library, group)
    if (!fs.existsSync(dir)) {
      continue
    }
    for (const name of fs.readdirSync(dir).sort()) {
      const folder = path.join(dir, name)
      if (!fs.existsSync(path.join(folder, 'coco.toml'))) {
        continue
      }
      // Whatever a previous drive generated is not this run's history.
      for (const generated of ['runs', 'report']) {
        fs.rmSync(path.join(folder, generated), { recursive: true, force: true })
      }
      folders.push(folder)
    }
  }
  const entities = Array.isArray(seed)
    ? seed.map((name) => path.join(library, name))
    : seed === 'library-only'
      ? []
      : folders
  // The store lists jobs and benches separately (convention §5); the library
  // keeps them in folders of those names.
  const side = (folder) => path.basename(path.dirname(folder))
  const store = {
    jobs: entities.filter((folder) => side(folder) === 'jobs'),
    benches: entities.filter((folder) => side(folder) === 'benches')
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2))
  // Whatever a previous drive arranged — window state on disk, the page's
  // own localStorage — is not this run's starting point either.
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true })
  return entities
}

// `DRIVE_PACKAGED=1` drives the *packaged* app (`npm run package:dir`) rather
// than the dev binary: same scenarios, but against what a user would install,
// which is the only way to find out that something did not make it into the
// asar.
const PACKAGED = process.env.DRIVE_PACKAGED === '1'

const DEV_BIN =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

const PACKAGED_BIN =
  process.platform === 'darwin'
    ? path.join(APP_DIR, `release/mac-${process.arch}/coco.app/Contents/MacOS/coco`)
    : path.join(APP_DIR, `release/linux-unpacked/coco`)

const ELECTRON_BIN = PACKAGED ? PACKAGED_BIN : DEV_BIN

const scenario_path = process.argv[2]
if (scenario_path === undefined) {
  console.error('usage: node scripts/drive.mjs <scenario.mjs>')
  process.exit(2)
}

// Loaded before the app: a scenario may say what the store should hold at
// launch, and the engine reads it exactly once, on construction.
const scenario = await import(pathToFileURL(path.resolve(scenario_path)).href)

fs.mkdirSync(SHOT_DIR, { recursive: true })
fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })

const log = (...parts) => console.log('·', ...parts)

// An explicit COCO_STORE_PATH is the caller's to prepare; otherwise the
// driver stands up a scratch library so a scenario has something to drive.
if (process.env.COCO_STORE_PATH === undefined) {
  // `seed: 'library-only'` copies the library but registers nothing, for a
  // scenario that means to add folders itself.
  const registered = seed_library(scenario.seed)
  log('seeded', registered.length, 'registered folders in', RUN_DIR)
}

// ELECTRON_RUN_AS_NODE leaks out of VSCode terminals and turns the Electron
// binary into a plain node, which never opens a window.
const env = {
  ...process.env,
  COCO_STORE_PATH: STORE_PATH,
  COCO_USER_DATA_DIR: USER_DATA_DIR,
  COCO_SOCKET_PATH: SOCKET_PATH,
  // `DRIVE_HEADLESS=1` runs the scenario without a window on screen — for
  // sweeping every scenario without eleven windows taking the focus in turn.
  // Screenshots still land in `.drive/shots/`: they come over CDP, not from
  // the compositor. Off by default, because watching it is the point.
  ...(process.env.DRIVE_HEADLESS === '1' ? { COCO_HIDE_WINDOW: '1' } : {})
}
delete env.ELECTRON_RUN_AS_NODE

const failures = []

/** The app and its window, replaced by `relaunch`. */
let app
let page

async function launch() {
  app = await electron.launch({
    executablePath: ELECTRON_BIN,
    // A packaged app *is* its own entry point; only the dev binary is told
    // which project to run.
    args: PACKAGED ? [] : [APP_DIR],
    env,
    timeout: 30_000
  })

  // The main process is the server here; its stderr is where a refused
  // operation or a crashed handler shows up.
  app.process().stdout?.on('data', (chunk) => process.stdout.write(`[main] ${chunk}`))
  app.process().stderr?.on('data', (chunk) => process.stdout.write(`[main] ${chunk}`))

  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(`console error: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  return { app, page }
}

/**
 * On macOS closing the last window does not quit the app — that is the
 * platform's convention and `index.ts` follows it, so waiting for an exit here
 * waits for one that never comes. Ask nicely, then insist.
 */
async function close() {
  const dying = app
  await Promise.race([
    dying.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ])
  try {
    dying.process().kill('SIGKILL')
  } catch {
    // Already gone.
  }
}

/**
 * Quits and starts again against the same store and the same ui-state file —
 * the only way to drive anything that is supposed to survive a launch.
 * Returns the new `{ app, page }`; the scenario's own `page` is stale after
 * this, though `shot` and `wait_text` follow the new window on their own.
 */
async function relaunch() {
  log('relaunching')
  await close()
  return launch()
}

await launch()

let shot_index = 0
async function shot(name) {
  shot_index += 1
  const file = path.join(SHOT_DIR, `${String(shot_index).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  log('screenshot', file)
  return file
}

/** Waits for text to appear anywhere on the page. */
async function wait_text(text, timeout = 10_000) {
  await page.locator(`text=${text}`).first().waitFor({ timeout })
}

try {
  await scenario.run({
    app,
    page,
    shot,
    log,
    wait_text,
    relaunch,
    library: path.join(RUN_DIR, 'examples'),
    window_state_path: WINDOW_STATE_PATH,
    socket_path: SOCKET_PATH
  })
  console.log('\nscenario finished')
} catch (error) {
  console.error('\nSCENARIO FAILED:', error.message)
  await shot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  // Always, and on the failure path especially: a renderer error is usually
  // the reason the scenario went wrong, and reporting it only on success
  // hides it exactly when it matters. Said before shutting down, so a slow
  // close cannot swallow it.
  if (failures.length > 0) {
    console.error('\nRENDERER ERRORS:')
    for (const failure of failures) {
      console.error('  ' + failure)
    }
    process.exitCode = 1
  } else {
    console.log('no renderer errors')
  }

  await close()
}
