import { homedir } from 'os'
import { join } from 'path'

export const config = {
  port: parseInt(process.env.PORT || '7373'),
  device: process.env.CHATLOG_DEVICE || 'windows',
  apiToken: process.env.CHATLOG_API_TOKEN || null,
  exportsDir: process.env.CHATLOG_EXPORTS_DIR || join(homedir(), '.local', 'share', 'opencode', 'exports'),
  extraDir: process.env.CHATLOG_EXTRA_DIR || null,
  dbPath: process.env.CHATLOG_DB_PATH || join(process.cwd(), 'data', 'chatlog.sqlite'),
  pollInterval: parseInt(process.env.CHATLOG_POLL_INTERVAL || '5000'),
}
