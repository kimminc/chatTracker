import { statSync } from 'fs'
import { db } from './db'
import { config } from './config'
import { parseJsonlFile } from './parser'

export async function indexFile(filePath: string): Promise<void> {
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return
  }

  const mtime = Math.round(stat.mtimeMs)
  const size = stat.size

  const existing = db.prepare('SELECT mtime FROM files WHERE path = ?').get(filePath) as
    | { mtime: number }
    | undefined
  if (existing && existing.mtime === mtime) return

  const { meta } = await parseJsonlFile(filePath)
  if (meta.message_count < 1) return

  const now = Date.now()

  db.prepare(`
    INSERT INTO sessions (session_id, started_at, ended_at, message_count, title, jsonl_path, jsonl_mtime, device, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      started_at    = COALESCE(sessions.started_at, excluded.started_at),
      ended_at      = excluded.ended_at,
      message_count = excluded.message_count,
      title         = COALESCE(sessions.title, excluded.title),
      jsonl_path    = excluded.jsonl_path,
      jsonl_mtime   = excluded.jsonl_mtime,
      indexed_at    = excluded.indexed_at
  `).run(
    meta.session_id,
    meta.started_at,
    meta.ended_at,
    meta.message_count,
    meta.title,
    filePath,
    mtime,
    config.device,
    now,
  )

  db.prepare(`
    INSERT INTO files (path, mtime, size, session_id, indexed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, indexed_at = excluded.indexed_at
  `).run(filePath, mtime, size, meta.session_id, now)
}
