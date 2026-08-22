// Manifest loading and validation (convention §2–§4). A manifest either loads
// or it does not; a folder whose manifest is broken stays visible with its
// error rather than being dropped.

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { EngineError } from './errors'
import * as template from './template'
import { split_command } from './words'

export type Kind = 'job' | 'bench'

/** A `command` value, split into argv at load time. Lexical only. */
export interface Command {
  words: string[]
  /** The manifest's original string, for display and errors. */
  display: string
}

export interface JobManifest {
  kind: 'job'
  name: string
  description?: string
  /** Relative path of the template inside the folder. */
  template: string
  render_params: string[]
  launch: Command
  launch_params: string[]
  poll: Command
  report: Command
  cancel: Command
}

export interface BenchManifest {
  kind: 'bench'
  name: string
  description?: string
  plan: Command
  plan_params: string[]
  report: Command
}

export type Manifest = JobManifest | BenchManifest

function parse_command(raw: string, manifest_path: string, key: string): Command {
  let words: string[]
  try {
    words = split_command(raw)
  } catch (cause) {
    throw EngineError.manifest(manifest_path, `${key} ${(cause as Error).message}`)
  }
  if (words.length === 0) {
    throw EngineError.manifest(manifest_path, `${key} command is empty`)
  }
  return { words, display: raw }
}

type TomlTable = Record<string, unknown>

function as_table(value: unknown): TomlTable | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TomlTable)
    : null
}

function reject_unknown_keys(table: TomlTable, allowed: string[], manifest_path: string): void {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) {
      throw EngineError.manifest(manifest_path, `invalid manifest: unknown field \`${key}\``)
    }
  }
}

function require_name(value: unknown, manifest_path: string): string {
  if (value === undefined) {
    throw EngineError.manifest(manifest_path, 'missing required key `name`')
  }
  if (typeof value !== 'string' || value === '') {
    throw EngineError.manifest(manifest_path, '`name` must be a non-empty string')
  }
  return value
}

function require_string(value: unknown, manifest_path: string, key: string): string {
  if (typeof value !== 'string') {
    throw EngineError.manifest(manifest_path, `missing required key \`${key}\``)
  }
  return value
}

function require_params(value: unknown, manifest_path: string, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw EngineError.manifest(manifest_path, `missing required key \`${key}\``)
  }
  const params = value as string[]
  const seen = new Set<string>()
  for (const name of params) {
    if (name === '') {
      throw EngineError.manifest(manifest_path, `\`${key}\` contains an empty parameter name`)
    }
    if (seen.has(name)) {
      throw EngineError.manifest(
        manifest_path,
        `\`${key}\` declares duplicate parameter \`${name}\``
      )
    }
    seen.add(name)
  }
  return params
}

function require_table(value: unknown, manifest_path: string, name: string): TomlTable {
  const table = as_table(value)
  if (table === null) {
    throw EngineError.manifest(manifest_path, `missing required table \`[${name}]\``)
  }
  return table
}

function require_file_in_folder(folder: string, manifest_path: string, rel: string): string {
  const joined = path.join(folder, rel)
  let canonical: string
  try {
    canonical = fs.realpathSync(joined)
  } catch {
    throw EngineError.manifest(
      manifest_path,
      `\`[render].template\` \`${rel}\` is not a file in the folder`
    )
  }
  if (!fs.statSync(canonical).isFile()) {
    throw EngineError.manifest(
      manifest_path,
      `\`[render].template\` \`${rel}\` is not a file in the folder`
    )
  }
  let folder_canonical: string
  try {
    folder_canonical = fs.realpathSync(folder)
  } catch (cause) {
    throw EngineError.io(folder, cause)
  }
  if (!canonical.startsWith(folder_canonical + path.sep)) {
    throw EngineError.manifest(
      manifest_path,
      `\`[render].template\` \`${rel}\` must be inside the folder`
    )
  }
  return canonical
}

/** Loads and validates `folder/coco.toml` (convention §4). */
export function load_manifest(folder: string): Manifest {
  const manifest_path = path.join(folder, 'coco.toml')
  let stat: fs.Stats
  try {
    stat = fs.statSync(manifest_path)
  } catch {
    throw EngineError.manifest(folder, 'no coco.toml in this folder')
  }
  if (!stat.isFile()) {
    throw EngineError.manifest(folder, 'no coco.toml in this folder')
  }
  let text: string
  try {
    text = fs.readFileSync(manifest_path, 'utf8')
  } catch (cause) {
    throw EngineError.io(manifest_path, cause)
  }
  let value: TomlTable
  try {
    value = parseToml(text)
  } catch (cause) {
    throw EngineError.manifest(
      manifest_path,
      `coco.toml does not parse: ${(cause as Error).message}`
    )
  }

  const kind = typeof value.kind === 'string' ? value.kind : ''
  if (kind === 'job') {
    return load_job(folder, manifest_path, value)
  }
  if (kind === 'bench') {
    return load_bench(manifest_path, value)
  }
  if (kind === '') {
    throw EngineError.manifest(manifest_path, 'missing required key `kind`')
  }
  throw EngineError.manifest(
    manifest_path,
    `\`kind\` must be \`job\` or \`bench\`, found \`${kind}\``
  )
}

function load_job(folder: string, manifest_path: string, raw: TomlTable): JobManifest {
  reject_unknown_keys(
    raw,
    ['kind', 'name', 'description', 'render', 'launch', 'poll', 'report', 'cancel'],
    manifest_path
  )

  const name = require_name(raw.name, manifest_path)
  const render = require_table(raw.render, manifest_path, 'render')
  reject_unknown_keys(render, ['template', 'params'], manifest_path)
  const launch = require_table(raw.launch, manifest_path, 'launch')
  reject_unknown_keys(launch, ['command', 'params'], manifest_path)
  const poll = require_table(raw.poll, manifest_path, 'poll')
  reject_unknown_keys(poll, ['command'], manifest_path)
  const report = require_table(raw.report, manifest_path, 'report')
  reject_unknown_keys(report, ['command'], manifest_path)
  const cancel = require_table(raw.cancel, manifest_path, 'cancel')
  reject_unknown_keys(cancel, ['command'], manifest_path)

  const template_name = require_string(render.template, manifest_path, '[render].template')
  const render_params = require_params(render.params, manifest_path, '[render].params')
  const launch_params = require_params(launch.params, manifest_path, '[launch].params')

  const overlap = render_params.filter((param) => launch_params.includes(param))
  if (overlap.length > 0) {
    throw EngineError.manifest(
      manifest_path,
      `parameter \`${overlap[0]}\` appears in both \`[render].params\` and \`[launch].params\``
    )
  }

  const template_abs = require_file_in_folder(folder, manifest_path, template_name)
  let source: string
  try {
    source = fs.readFileSync(template_abs, 'utf8')
  } catch (cause) {
    throw EngineError.io(template_abs, cause)
  }
  try {
    template.analyze(source, render_params)
  } catch (cause) {
    throw EngineError.manifest(
      template_abs,
      `template does not match \`[render].params\`: ${(cause as Error).message}`
    )
  }

  return {
    kind: 'job',
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    template: template_name,
    render_params: render_params,
    launch: parse_command(
      require_string(launch.command, manifest_path, '[launch].command'),
      manifest_path,
      '[launch].command'
    ),
    launch_params: launch_params,
    poll: parse_command(
      require_string(poll.command, manifest_path, '[poll].command'),
      manifest_path,
      '[poll].command'
    ),
    report: parse_command(
      require_string(report.command, manifest_path, '[report].command'),
      manifest_path,
      '[report].command'
    ),
    cancel: parse_command(
      require_string(cancel.command, manifest_path, '[cancel].command'),
      manifest_path,
      '[cancel].command'
    )
  }
}

function load_bench(manifest_path: string, raw: TomlTable): BenchManifest {
  reject_unknown_keys(raw, ['kind', 'name', 'description', 'plan', 'report'], manifest_path)

  const name = require_name(raw.name, manifest_path)
  const plan = require_table(raw.plan, manifest_path, 'plan')
  reject_unknown_keys(plan, ['command', 'params'], manifest_path)
  const report = require_table(raw.report, manifest_path, 'report')
  reject_unknown_keys(report, ['command'], manifest_path)

  return {
    kind: 'bench',
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    plan: parse_command(
      require_string(plan.command, manifest_path, '[plan].command'),
      manifest_path,
      '[plan].command'
    ),
    plan_params: require_params(plan.params, manifest_path, '[plan].params'),
    report: parse_command(
      require_string(report.command, manifest_path, '[report].command'),
      manifest_path,
      '[report].command'
    )
  }
}
