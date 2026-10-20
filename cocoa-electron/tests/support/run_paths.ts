import path from 'node:path'

export function run_dir(folder: string, run_id: number): string {
  return path.join(folder, 'runs', String(run_id))
}

export function record_path(folder: string, run_id: number): string {
  return path.join(run_dir(folder, run_id), 'run.json')
}

export function report_path(folder: string, run_id: number): string {
  return path.join(folder, 'report', `${run_id}.txt`)
}
