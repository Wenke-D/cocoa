import path from 'node:path'
import { Engine } from '../../src/main/engine/engine'
import type { Config } from '../../src/main/engine/config'

export function engine(dir: string, config?: Config): Engine {
  return config === undefined
    ? new Engine(path.join(dir, 'store.json'))
    : new Engine(path.join(dir, 'store.json'), config)
}

/**
 * Waits for every launch script to land, as the workbench's refresh tick
 * would collect them one by one. Tests assert on the settled record.
 */
export async function settle(cocoa: Engine): Promise<string[]> {
  const errors = await cocoa.settle_launches()
  return errors.map((error) => error.message)
}
