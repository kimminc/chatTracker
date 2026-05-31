import { readdirSync } from 'fs'
import { join } from 'path'
import { config } from './config'
import { indexFile } from './indexer'

// Always scan every file — indexFile skips unchanged mtimes, so this is cheap.
// Directory-mtime gating doesn't work on Windows for file modifications.
async function scanDir(dir: string): Promise<void> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl'))
  for (const f of jsonlFiles) {
    await indexFile(join(dir, f))
  }
}

async function tick(): Promise<void> {
  await scanDir(config.exportsDir)
  if (config.extraDir) await scanDir(config.extraDir)
}

let tickInterval: ReturnType<typeof setInterval> | null = null

export async function startWatcher(): Promise<void> {
  await tick()
  tickInterval = setInterval(tick, config.pollInterval)
  console.log(`Watcher: polling every ${config.pollInterval / 1000}s`)
  console.log(`  exports: ${config.exportsDir}`)
  if (config.extraDir) console.log(`  extra:   ${config.extraDir}`)
}

export function updatePollInterval(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval)
    tickInterval = setInterval(tick, config.pollInterval)
    console.log(`Watcher: poll interval updated to ${config.pollInterval}ms`)
  }
}
