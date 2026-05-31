import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { config } from './config'

function createDb() {
  mkdirSync(dirname(config.dbPath), { recursive: true })
  const db = new Database(config.dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id    TEXT PRIMARY KEY,
      started_at    TEXT,
      ended_at      TEXT,
      message_count INTEGER DEFAULT 0,
      title         TEXT,
      custom_title  TEXT,
      jsonl_path    TEXT,
      jsonl_mtime   INTEGER,
      device        TEXT,
      hidden        INTEGER DEFAULT 0,
      hidden_at     INTEGER,
      indexed_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_title   ON sessions(title);
    CREATE INDEX IF NOT EXISTS idx_hidden  ON sessions(hidden);

    CREATE TABLE IF NOT EXISTS files (
      path        TEXT PRIMARY KEY,
      mtime       INTEGER,
      size        INTEGER,
      session_id  TEXT,
      indexed_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return db
}

export const db = createDb()
