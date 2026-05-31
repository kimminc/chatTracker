import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { basename } from 'path'

export interface Message {
  timestamp: string
  sessionID: string
  messageId: string
  role: 'user' | 'assistant'
  content: string
}

export interface SessionMeta {
  session_id: string
  started_at: string | null
  ended_at: string | null
  message_count: number
  title: string | null
}

export function extractSessionId(filePath: string): string {
  return basename(filePath, '.jsonl')
}

export async function parseJsonlFile(
  filePath: string,
  maxLines = 0,
): Promise<{ meta: SessionMeta; messages: Message[] }> {
  const session_id = extractSessionId(filePath)

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  // messageId → Message map: later lines overwrite earlier ones (dedup by messageId)
  const seen = new Map<string, Message>()
  const order: string[] = []

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      if (obj.role === 'user' || obj.role === 'assistant') {
        const id = obj.messageId || `${obj.role}:${obj.timestamp}`
        const msg: Message = {
          timestamp: obj.timestamp ?? '',
          sessionID: obj.sessionID ?? session_id,
          messageId: id,
          role: obj.role,
          content: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content),
        }
        if (!seen.has(id)) order.push(id)
        seen.set(id, msg)
        if (maxLines > 0 && seen.size >= maxLines) break
      }
    } catch {
      // skip malformed lines
    }
  }

  rl.close()

  const messages = order.map((id) => seen.get(id)!)

  const firstUser = messages.find((m) => m.role === 'user')
  const title = firstUser ? firstUser.content.slice(0, 120).replace(/\n/g, ' ') : null

  return {
    meta: {
      session_id,
      started_at: messages[0]?.timestamp || null,
      ended_at: messages[messages.length - 1]?.timestamp || null,
      message_count: messages.length,
      title,
    },
    messages,
  }
}
