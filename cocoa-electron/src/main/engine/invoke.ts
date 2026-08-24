// Script invocation. The Electron main process must not block, so `run` is
// async, and `Running` is the non-blocking harvest shape: `try_finish()`
// answers without waiting.

import { spawn as spawnProcess } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

export interface Invocation {
  exit: number | null
  timed_out: boolean
  stdout: string
  stderr: string
}

/** Whether the script "did its job": exited 0 before the timeout. */
export function invocation_ok(invocation: Invocation): boolean {
  return !invocation.timed_out && invocation.exit === 0
}

/** Captured stdout and stderr combined, for operation errors. */
export function invocation_output(invocation: Invocation): string {
  const out = invocation.stdout.trimEnd()
  const err = invocation.stderr.trimEnd()
  if (out === '' && err === '') {
    return ''
  }
  if (err === '') {
    return out
  }
  if (out === '') {
    return err
  }
  return `${out}\n${err}`
}

/**
 * How long a finished script's pipes get to drain before the invocation is
 * answered anyway. A grandchild that inherited stdout — a backgrounded
 * process, or the `sleep` left behind when a killed shell's child outlives
 * it — holds the pipe open after the script itself is gone, so waiting for
 * EOF (Node's `close`) would mean waiting for the grandchild. The script's
 * own output has already been read by then; this is only the flush window.
 */
const DRAIN_MS = 100

/** A script that has been started and not yet collected. */
export class Running {
  private readonly child: ChildProcess
  private stdout = ''
  private stderr = ''
  private finished: Invocation | null = null
  private timed_out = false
  private readonly timer: NodeJS.Timeout
  private drain_timer: NodeJS.Timeout | null = null
  private settle!: () => void
  private readonly closed: Promise<void>
  /** The spawn handshake: resolves once the OS has started the process,
   * rejects if it could not be started at all. */
  readonly started: Promise<void>

  constructor(cwd: string, argv: string[], timeout_ms: number) {
    if (argv.length === 0) {
      throw new Error('argv must name the script or interpreter')
    }
    this.closed = new Promise((resolve) => {
      this.settle = resolve
    })
    this.child = spawnProcess(argv[0], argv.slice(1), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.started = new Promise((resolve, reject) => {
      this.child.once('spawn', () => resolve())
      this.child.once('error', reject)
    })
    // Awaiting the handshake is `spawn`'s business; nobody else has to.
    this.started.catch(() => {})

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.stdout += chunk.toString('utf8')
    })
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8')
    })
    this.timer = setTimeout(() => {
      this.timed_out = true
      this.child.kill('SIGKILL')
    }, timeout_ms)

    // `exit` says the script is gone; `close` says its pipes are too. Answer
    // on `close` when it comes, but never wait on it longer than the drain
    // window: a grandchild holding stdout would otherwise keep an invocation
    // — and with it the refresh tick — open forever.
    this.child.on('exit', (code) => {
      this.drain_timer = setTimeout(() => this.finish(code), DRAIN_MS)
    })
    this.child.on('close', (code) => this.finish(code))
    this.child.on('error', (error) => {
      // Spawn succeeded but the process later failed to be tracked; treat
      // as a killed script carrying the error text.
      this.stderr = `${this.stderr}\n${error.message}`.trim()
      this.finish(null)
    })
  }

  private finish(code: number | null): void {
    if (this.finished !== null) {
      return
    }
    clearTimeout(this.timer)
    if (this.drain_timer !== null) {
      clearTimeout(this.drain_timer)
    }
    this.finished = {
      exit: this.timed_out ? null : code,
      timed_out: this.timed_out,
      stdout: this.stdout,
      stderr: this.stderr
    }
    this.settle()
  }

  /** Collects the script if it has finished, without waiting for it. */
  try_finish(): Invocation | null {
    return this.finished
  }

  /** Waits for the script to finish (the timeout kills it at the deadline). */
  async wait(): Promise<Invocation> {
    await this.closed
    return this.finished as Invocation
  }

  /** Kills the script without collecting it. For shutdown. */
  kill(): void {
    clearTimeout(this.timer)
    this.child.kill('SIGKILL')
  }
}

/**
 * Starts `argv` with `cwd`, capturing output. Throws synchronously only when
 * the process cannot be started at all (missing interpreter, bad cwd) — the
 * same distinction the Rust engine draws for a start refusal.
 */
export async function spawn(cwd: string, argv: string[], timeout_ms: number): Promise<Running> {
  const running = new Running(cwd, argv, timeout_ms)
  await running.started
  return running
}

/** Runs `argv` to completion. */
export async function run(cwd: string, argv: string[], timeout_ms: number): Promise<Invocation> {
  const running = await spawn(cwd, argv, timeout_ms)
  return running.wait()
}

/**
 * Every stdout line beginning with `COCOA_RETURN: `, prefix and surrounding
 * whitespace removed. All other output is ignored, so scripts may log freely.
 */
export function cocoa_return_lines(stdout: string): string[] {
  const lines: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.startsWith('COCOA_RETURN: ')) {
      lines.push(line.slice('COCOA_RETURN: '.length).trim())
    }
  }
  return lines
}
