import { db } from './db'
import { config } from './config'

export type SettingKey = 'exports_dir' | 'extra_dir' | 'device' | 'api_token' | 'poll_interval'

const ENV_MAP: Record<SettingKey, string> = {
  exports_dir:   'CHATLOG_EXPORTS_DIR',
  extra_dir:     'CHATLOG_EXTRA_DIR',
  device:        'CHATLOG_DEVICE',
  api_token:     'CHATLOG_API_TOKEN',
  poll_interval: 'CHATLOG_POLL_INTERVAL',
}

function applyToConfig(key: SettingKey, value: string) {
  switch (key) {
    case 'exports_dir':
      if (value) config.exportsDir = value
      break
    case 'extra_dir':
      config.extraDir = value || null
      break
    case 'device':
      if (value) config.device = value
      break
    case 'api_token':
      config.apiToken = value || null
      break
    case 'poll_interval': {
      const n = parseInt(value)
      if (n >= 1000) config.pollInterval = n
      break
    }
  }
}

export function loadSettingsFromDb() {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  for (const { key, value } of rows) {
    if (key in ENV_MAP && !process.env[ENV_MAP[key as SettingKey]]) {
      applyToConfig(key as SettingKey, value)
    }
  }
}

export function saveSetting(key: SettingKey, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  if (!process.env[ENV_MAP[key]]) {
    applyToConfig(key, value)
  }
}

type Source = 'env' | 'db' | 'default'
type Entry = { value: string | number | null; source: Source; locked: boolean }

export function getSettingsResponse(): Record<string, Entry> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const dbMap: Record<string, string> = {}
  for (const r of rows) dbMap[r.key] = r.value

  function entry(key: SettingKey, current: string | number | null): Entry {
    const locked = !!process.env[ENV_MAP[key]]
    return {
      value:  current,
      source: locked ? 'env' : dbMap[key] !== undefined ? 'db' : 'default',
      locked,
    }
  }

  return {
    exports_dir:   entry('exports_dir',   config.exportsDir),
    extra_dir:     entry('extra_dir',     config.extraDir),
    device:        entry('device',        config.device),
    api_token:     entry('api_token',     config.apiToken),
    poll_interval: entry('poll_interval', config.pollInterval),
  }
}
