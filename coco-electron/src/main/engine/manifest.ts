// Manifest loading and validation (convention §2–§4). Port of
// engine/manifest.rs. A manifest either loads or it does not; a folder whose
// manifest is broken stays visible with its error rather than being dropped.

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { EngineError } from './errors'
import * as template from './template'
import { splitCommand } from './words'

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

function parseCommand(raw: string, manifestPath: string, key: string): Command {
  let words: string[]
  try {
    words = splitCommand(raw)
  } catch (cause) {
    throw EngineError.manifest(manifestPath, `${key} ${(cause as Error).message}`)
  }
  if (words.length === 0) {
    throw EngineError.manifest(manifestPath, `${key} command is empty`)
  }
  return { words, display: raw }
}

type TomlTable = Record<string, unknown>

function asTable(value: unknown): TomlTable | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TomlTable)
    : null
}

function rejectUnknownKeys(table: TomlTable, allowed: string[], manifestPath: string): void {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) {
      throw EngineError.manifest(manifestPath, `invalid manifest: unknown field \`${key}\``)
    }
  }
}

function requireName(value: unknown, manifestPath: string): string {
  if (value === undefined) {
    throw EngineError.manifest(manifestPath, 'missing required key `name`')
  }
  if (typeof value !== 'string' || value === '') {
    throw EngineError.manifest(manifestPath, '`name` must be a non-empty string')
  }
  return value
}

function requireString(value: unknown, manifestPath: string, key: string): string {
  if (typeof value !== 'string') {
    throw EngineError.manifest(manifestPath, `missing required key \`${key}\``)
  }
  return value
}

function requireParams(value: unknown, manifestPath: string, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw EngineError.manifest(manifestPath, `missing required key \`${key}\``)
  }
  const params = value as string[]
  const seen = new Set<string>()
  for (const name of params) {
    if (name === '') {
      throw EngineError.manifest(manifestPath, `\`${key}\` contains an empty parameter name`)
    }
    if (seen.has(name)) {
      throw EngineError.manifest(manifestPath, `\`${key}\` declares duplicate parameter \`${name}\``)
    }
    seen.add(name)
  }
  return params
}

function requireTable(value: unknown, manifestPath: string, name: string): TomlTable {
  const table = asTable(value)
  if (table === null) {
    throw EngineError.manifest(manifestPath, `missing required table \`[${name}]\``)
  }
  return table
}

function requireFileInFolder(folder: string, manifestPath: string, rel: string): string {
  const joined = path.join(folder, rel)
  let canonical: string
  try {
    canonical = fs.realpathSync(joined)
  } catch {
    throw EngineError.manifest(
      manifestPath,
      `\`[render].template\` \`${rel}\` is not a file in the folder`
    )
  }
  if (!fs.statSync(canonical).isFile()) {
    throw EngineError.manifest(
      manifestPath,
      `\`[render].template\` \`${rel}\` is not a file in the folder`
    )
  }
  let folderCanonical: string
  try {
    folderCanonical = fs.realpathSync(folder)
  } catch (cause) {
    throw EngineError.io(folder, cause)
  }
  if (!canonical.startsWith(folderCanonical + path.sep)) {
    throw EngineError.manifest(
      manifestPath,
      `\`[render].template\` \`${rel}\` must be inside the folder`
    )
  }
  return canonical
}

/** Loads and validates `folder/coco.toml` (convention §4). */
export function loadManifest(folder: string): Manifest {
  const manifestPath = path.join(folder, 'coco.toml')
  let stat: fs.Stats
  try {
    stat = fs.statSync(manifestPath)
  } catch {
    throw EngineError.manifest(folder, 'no coco.toml in this folder')
  }
  if (!stat.isFile()) {
    throw EngineError.manifest(folder, 'no coco.toml in this folder')
  }
  let text: string
  try {
    text = fs.readFileSync(manifestPath, 'utf8')
  } catch (cause) {
    throw EngineError.io(manifestPath, cause)
  }
  let value: TomlTable
  try {
    value = parseToml(text) as TomlTable
  } catch (cause) {
    throw EngineError.manifest(manifestPath, `coco.toml does not parse: ${(cause as Error).message}`)
  }

  const kind = typeof value.kind === 'string' ? value.kind : ''
  if (kind === 'job') return loadJob(folder, manifestPath, value)
  if (kind === 'bench') return loadBench(manifestPath, value)
  if (kind === '') {
    throw EngineError.manifest(manifestPath, 'missing required key `kind`')
  }
  throw EngineError.manifest(manifestPath, `\`kind\` must be \`job\` or \`bench\`, found \`${kind}\``)
}

function loadJob(folder: string, manifestPath: string, raw: TomlTable): JobManifest {
  rejectUnknownKeys(raw, ['kind', 'name', 'description', 'render', 'launch', 'poll', 'report', 'cancel'], manifestPath)

  const name = requireName(raw.name, manifestPath)
  const render = requireTable(raw.render, manifestPath, 'render')
  rejectUnknownKeys(render, ['template', 'params'], manifestPath)
  const launch = requireTable(raw.launch, manifestPath, 'launch')
  rejectUnknownKeys(launch, ['command', 'params'], manifestPath)
  const poll = requireTable(raw.poll, manifestPath, 'poll')
  rejectUnknownKeys(poll, ['command'], manifestPath)
  const report = requireTable(raw.report, manifestPath, 'report')
  rejectUnknownKeys(report, ['command'], manifestPath)
  const cancel = requireTable(raw.cancel, manifestPath, 'cancel')
  rejectUnknownKeys(cancel, ['command'], manifestPath)

  const templateName = requireString(render.template, manifestPath, '[render].template')
  const renderParams = requireParams(render.params, manifestPath, '[render].params')
  const launchParams = requireParams(launch.params, manifestPath, '[launch].params')

  const overlap = renderParams.filter((param) => launchParams.includes(param))
  if (overlap.length > 0) {
    throw EngineError.manifest(
      manifestPath,
      `parameter \`${overlap[0]}\` appears in both \`[render].params\` and \`[launch].params\``
    )
  }

  const templateAbs = requireFileInFolder(folder, manifestPath, templateName)
  let source: string
  try {
    source = fs.readFileSync(templateAbs, 'utf8')
  } catch (cause) {
    throw EngineError.io(templateAbs, cause)
  }
  try {
    template.analyze(source, renderParams)
  } catch (cause) {
    throw EngineError.manifest(
      templateAbs,
      `template does not match \`[render].params\`: ${(cause as Error).message}`
    )
  }

  return {
    kind: 'job',
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    template: templateName,
    render_params: renderParams,
    launch: parseCommand(requireString(launch.command, manifestPath, '[launch].command'), manifestPath, '[launch].command'),
    launch_params: launchParams,
    poll: parseCommand(requireString(poll.command, manifestPath, '[poll].command'), manifestPath, '[poll].command'),
    report: parseCommand(requireString(report.command, manifestPath, '[report].command'), manifestPath, '[report].command'),
    cancel: parseCommand(requireString(cancel.command, manifestPath, '[cancel].command'), manifestPath, '[cancel].command')
  }
}

function loadBench(manifestPath: string, raw: TomlTable): BenchManifest {
  rejectUnknownKeys(raw, ['kind', 'name', 'description', 'plan', 'report'], manifestPath)

  const name = requireName(raw.name, manifestPath)
  const plan = requireTable(raw.plan, manifestPath, 'plan')
  rejectUnknownKeys(plan, ['command', 'params'], manifestPath)
  const report = requireTable(raw.report, manifestPath, 'report')
  rejectUnknownKeys(report, ['command'], manifestPath)

  return {
    kind: 'bench',
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    plan: parseCommand(requireString(plan.command, manifestPath, '[plan].command'), manifestPath, '[plan].command'),
    plan_params: requireParams(plan.params, manifestPath, '[plan].params'),
    report: parseCommand(requireString(report.command, manifestPath, '[report].command'), manifestPath, '[report].command')
  }
}
