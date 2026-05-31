import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { cors } from 'hono/cors'
import { join } from 'path'
import { createReadStream } from 'fs'
import { config } from './config'
import { db } from './db'
import { parseJsonlFile } from './parser'
import { startWatcher, updatePollInterval } from './watcher'
import { loadSettingsFromDb, saveSetting, getSettingsResponse, SettingKey } from './settings'

const app = new Hono()

// CORS
app.use('/api/*', cors())
app.use('/mcp', cors())

// Bearer auth for /mcp
app.use('/mcp', async (c, next) => {
  if (!config.apiToken) return next()
  const auth = c.req.header('Authorization') ?? ''
  if (auth !== `Bearer ${config.apiToken}`) {
    return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }, 401)
  }
  return next()
})

// ─── API ─────────────────────────────────────────────────────────────────────

app.get('/api/sessions', (c) => {
  const q            = c.req.query('q') ?? ''
  const per_page     = Math.min(parseInt(c.req.query('per_page') ?? '20'), 100)
  const page         = Math.max(parseInt(c.req.query('page') ?? '1'), 1)
  const offset       = (page - 1) * per_page
  const date_from    = c.req.query('date_from') ?? ''
  const date_to      = c.req.query('date_to') ?? ''
  const include_hidden = c.req.query('include_hidden') === '1'

  const conds: string[] = []
  const params: unknown[] = []

  if (!include_hidden) { conds.push('hidden = 0') }
  if (q) {
    conds.push('(title LIKE ? OR custom_title LIKE ? OR session_id LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (date_from) {
    conds.push("COALESCE(ended_at, started_at) >= ?")
    params.push(date_from)
  }
  if (date_to) {
    conds.push("COALESCE(ended_at, started_at) <= ?")
    params.push(date_to)
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM sessions ${where}`)
    .get(...params as []) as { n: number }).n

  const sessions = db.prepare(`
    SELECT session_id, started_at, ended_at, message_count, indexed_at,
           COALESCE(custom_title, title) AS display_title, title, device
    FROM sessions ${where}
    ORDER BY COALESCE(ended_at, started_at) DESC
    LIMIT ? OFFSET ?
  `).all(...params as [], per_page, offset)

  return c.json({ sessions, total, page, pages: Math.ceil(total / per_page), per_page })
})

// ── Content search ────────────────────────────────────────────────────────────
function extractSnippet(text: string, query: string, radius = 90): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end   = Math.min(text.length, idx + query.length + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

app.get('/api/search/content', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ results: [], total: 0 })

  type SessRow = { session_id: string; display_title: string; started_at: string; ended_at: string; message_count: number; jsonl_path: string }
  const allSessions = db.prepare(
    `SELECT session_id, COALESCE(custom_title,title) AS display_title,
            started_at, ended_at, message_count, jsonl_path
     FROM sessions WHERE hidden = 0 AND jsonl_path IS NOT NULL`
  ).all() as SessRow[]

  const results = []
  const qLow = q.toLowerCase()
  for (const sess of allSessions) {
    try {
      const { messages } = await parseJsonlFile(sess.jsonl_path, 2000)
      const hits = messages.filter(m => m.content.toLowerCase().includes(qLow))
      if (hits.length > 0) {
        results.push({
          session_id:   sess.session_id,
          display_title: sess.display_title,
          started_at:   sess.started_at,
          ended_at:     sess.ended_at,
          message_count: sess.message_count,
          match_count:  hits.length,
          snippets: hits.slice(0, 2).map(m => ({
            role:    m.role,
            snippet: extractSnippet(m.content, q),
          })),
        })
      }
    } catch { /* skip unreadable */ }
  }

  results.sort((a, b) => b.match_count - a.match_count)
  return c.json({ results, total: results.length })
})

app.get('/api/sessions/:id', (c) => {
  const id = c.req.param('id')
  const row = db.prepare(`
    SELECT session_id, started_at, ended_at, message_count,
           COALESCE(custom_title, title) AS display_title, title, device, jsonl_path, hidden
    FROM sessions WHERE session_id = ?
  `).get(id)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

app.get('/api/sessions/:id/messages', async (c) => {
  const id = c.req.param('id')
  const max = Math.min(parseInt(c.req.query('max_messages') ?? '500'), 2000)

  const row = db.prepare('SELECT jsonl_path FROM sessions WHERE session_id = ?').get(id) as
    | { jsonl_path: string }
    | undefined
  if (!row?.jsonl_path) return c.json({ error: 'not found' }, 404)

  try {
    const { messages } = await parseJsonlFile(row.jsonl_path, max)
    return c.json(messages)
  } catch {
    return c.json({ error: 'failed to read session file' }, 500)
  }
})

app.get('/api/sessions/:id/export', async (c) => {
  const id = c.req.param('id')
  const row = db.prepare(`
    SELECT session_id, started_at, ended_at, message_count,
           COALESCE(custom_title, title) AS display_title, jsonl_path
    FROM sessions WHERE session_id = ?
  `).get(id) as
    | { session_id: string; started_at: string; ended_at: string; message_count: number; display_title: string; jsonl_path: string }
    | undefined
  if (!row?.jsonl_path) return c.json({ error: 'not found' }, 404)

  const { messages } = await parseJsonlFile(row.jsonl_path, 2000)

  const lines: string[] = [
    `# ${row.display_title || row.session_id}`,
    '',
    `- **세션 ID:** \`${row.session_id}\``,
    `- **시작:** ${row.started_at ?? '-'}`,
    `- **종료:** ${row.ended_at ?? '-'}`,
    `- **메시지:** ${row.message_count}개`,
    '',
    '---',
    '',
  ]

  for (const msg of messages) {
    const who = msg.role === 'user' ? '**User**' : '**Assistant**'
    const ts = msg.timestamp ? ` <sub>${new Date(msg.timestamp).toLocaleString('ko-KR')}</sub>` : ''
    lines.push(`### ${who}${ts}`, '', msg.content, '', '---', '')
  }

  const md = lines.join('\n')
  const filename = `${id}.md`

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

app.patch('/api/sessions/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ custom_title?: string; hidden?: boolean }>()

  if (body.custom_title !== undefined) {
    db.prepare('UPDATE sessions SET custom_title = ? WHERE session_id = ?').run(body.custom_title || null, id)
  }
  if (body.hidden !== undefined) {
    db.prepare('UPDATE sessions SET hidden = ?, hidden_at = ? WHERE session_id = ?').run(
      body.hidden ? 1 : 0,
      body.hidden ? Date.now() : null,
      id,
    )
  }
  return c.json({ ok: true })
})

app.get('/api/stats', (c) => {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE hidden = 0').get() as { n: number }).n
  const indexed = (db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
  const latest = (
    db.prepare(`SELECT MAX(COALESCE(ended_at, started_at)) AS ts FROM sessions WHERE hidden = 0`).get() as {
      ts: string | null
    }
  ).ts
  return c.json({ total_sessions: total, indexed_files: indexed, latest_activity: latest })
})

app.get('/api/settings', (c) => {
  return c.json(getSettingsResponse())
})

app.put('/api/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>()
  const allowed: SettingKey[] = ['exports_dir', 'extra_dir', 'device', 'api_token', 'poll_interval']
  let pollChanged = false
  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key as SettingKey)) {
      saveSetting(key as SettingKey, String(value ?? ''))
      if (key === 'poll_interval') pollChanged = true
    }
  }
  if (pollChanged) updatePollInterval()
  return c.json({ ok: true, settings: getSettingsResponse() })
})

app.get('/api/openapi.json', (c) => {
  return c.json({
    openapi: '3.0.3',
    info: { title: 'chatTracker API', version: '0.1.0', description: 'opencode 세션 인덱서 & MCP 서버' },
    servers: [{ url: `http://localhost:${config.port}` }],
    paths: {
      '/api/sessions': {
        get: {
          summary: '세션 목록/검색',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'include_hidden', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
          ],
          responses: { '200': { description: '세션 배열' } },
        },
      },
      '/api/sessions/{id}': {
        get: {
          summary: '세션 메타 조회',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '세션 메타' }, '404': { description: '없음' } },
        },
        patch: {
          summary: '세션 수정 (제목/숨김)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { custom_title: { type: 'string' }, hidden: { type: 'boolean' } },
                },
              },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/api/sessions/{id}/messages': {
        get: {
          summary: '세션 메시지 조회 (lazy)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'max_messages', in: 'query', schema: { type: 'integer', default: 500 } },
          ],
          responses: { '200': { description: '메시지 배열' } },
        },
      },
      '/api/sessions/{id}/export': {
        get: {
          summary: '세션 마크다운 내보내기',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'text/markdown 파일' } },
        },
      },
      '/api/stats': {
        get: {
          summary: '인덱스 통계',
          responses: { '200': { description: '통계 객체' } },
        },
      },
    },
  })
})

// ─── MCP ─────────────────────────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'search_sessions',
    description: '사용자가 과거에 나눈 opencode 대화 기록(세션)을 키워드로 검색합니다. "저번에 ~했던 거 찾아줘", "~관련 대화 있었어?" 같은 요청에 사용하세요. 현재 뉴스·주가·날씨 등 실시간 정보 검색 용도가 아닙니다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색 키워드 (제목·세션ID 부분 일치)' },
        page: { type: 'number', description: '페이지 번호 (기본 1)' },
        per_page: { type: 'number', description: '페이지당 결과 수 (기본 10, 최대 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent',
    description: '사용자가 최근에 진행한 opencode 대화 세션 목록을 반환합니다. "요즘 뭐했어?", "최근 대화 보여줘" 같은 요청에 사용하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: '페이지 번호 (기본 1)' },
        per_page: { type: 'number', description: '페이지당 결과 수 (기본 10, 최대 50)' },
      },
    },
  },
  {
    name: 'list_projects',
    description: '월별 대화 세션 수와 마지막 활동 시각을 반환합니다. 사용자의 활동 패턴이나 특정 기간에 얼마나 대화했는지 파악할 때 사용하세요.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_session',
    description: '특정 세션 ID의 전체 대화 메시지를 조회합니다. 세션 ID를 이미 알고 있을 때, 또는 search_sessions/list_recent로 찾은 세션의 상세 내용을 읽을 때 사용하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: '조회할 세션 ID (예: ses_18c2ec...)' },
        max_messages: { type: 'number', description: '최대 메시지 수 (기본 200)' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'stats',
    description: '인덱스된 전체 대화 세션 수와 가장 최근 활동 시각을 반환합니다. "대화 몇 개야?", "마지막으로 대화한 게 언제야?" 같은 요청에 사용하세요.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function formatRows(rows: { session_id: string; started_at: string; ended_at: string; message_count: number; t: string }[]): string {
  return rows.map((r) => `- ${r.session_id}\n  ${(r.t ?? '').slice(0, 80)}\n  ${r.ended_at ?? r.started_at} · ${r.message_count}msgs`).join('\n\n')
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'search_sessions') {
    const q = String(args.query ?? '')
    const per_page = Math.min(Number(args.per_page ?? 10), 50)
    const page = Math.max(Number(args.page ?? 1), 1)
    const offset = (page - 1) * per_page

    const total = (db.prepare(
      `SELECT COUNT(*) AS n FROM sessions WHERE hidden=0 AND (title LIKE ? OR custom_title LIKE ? OR session_id LIKE ?)`
    ).get(`%${q}%`, `%${q}%`, `%${q}%`) as { n: number }).n

    if (total === 0) return `검색 결과 없음: "${q}"`

    const rows = db
      .prepare(
        `SELECT session_id, started_at, ended_at, message_count, COALESCE(custom_title,title) AS t
         FROM sessions WHERE hidden=0 AND (title LIKE ? OR custom_title LIKE ? OR session_id LIKE ?)
         ORDER BY COALESCE(ended_at,started_at) DESC LIMIT ? OFFSET ?`,
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`, per_page, offset) as { session_id: string; started_at: string; ended_at: string; message_count: number; t: string }[]

    const pages = Math.ceil(total / per_page)
    const header = `검색 결과 (총 ${total}건, ${page}/${pages} 페이지):\n\n`
    const footer = pages > 1 ? `\n\n[${page}/${pages} 페이지 — 더 보려면 page: ${page + 1} 로 재요청]` : ''
    return header + formatRows(rows) + footer
  }

  if (name === 'list_recent') {
    const per_page = Math.min(Number(args.per_page ?? 10), 50)
    const page = Math.max(Number(args.page ?? 1), 1)
    const offset = (page - 1) * per_page

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE hidden=0`).get() as { n: number }).n

    const rows = db
      .prepare(
        `SELECT session_id, started_at, ended_at, message_count, COALESCE(custom_title,title) AS t
         FROM sessions WHERE hidden=0 ORDER BY COALESCE(ended_at,started_at) DESC LIMIT ? OFFSET ?`,
      )
      .all(per_page, offset) as { session_id: string; started_at: string; ended_at: string; message_count: number; t: string }[]

    const pages = Math.ceil(total / per_page)
    const header = `최근 세션 (총 ${total}개, ${page}/${pages} 페이지):\n\n`
    const footer = pages > 1 ? `\n\n[${page}/${pages} 페이지 — 더 보려면 page: ${page + 1} 로 재요청]` : ''
    return header + formatRows(rows) + footer
  }

  if (name === 'list_projects') {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m', started_at) AS month, COUNT(*) AS n, MAX(COALESCE(ended_at,started_at)) AS last
         FROM sessions WHERE hidden=0 GROUP BY month ORDER BY month DESC`,
      )
      .all() as { month: string; n: number; last: string }[]
    if (rows.length === 0) return '세션 없음'
    return rows.map((r) => `- ${r.month}: ${r.n}세션, 마지막 활동 ${r.last}`).join('\n')
  }

  if (name === 'get_session') {
    const id = String(args.session_id ?? '')
    const max = Math.min(Number(args.max_messages ?? 200), 2000)
    const row = db
      .prepare(
        `SELECT session_id, started_at, ended_at, message_count, COALESCE(custom_title,title) AS t, jsonl_path
         FROM sessions WHERE session_id = ?`,
      )
      .get(id) as { session_id: string; started_at: string; ended_at: string; message_count: number; t: string; jsonl_path: string } | undefined
    if (!row) return `세션을 찾을 수 없음: ${id}`

    const { messages } = await parseJsonlFile(row.jsonl_path, max)
    const header = `session_id: ${row.session_id}\ntitle: ${row.t}\nstarted: ${row.started_at}\nended: ${row.ended_at}\nmessages: ${row.message_count}\n---\n`
    const body = messages
      .map((m) => `[${m.role.toUpperCase()} ${m.timestamp}]\n${m.content}`)
      .join('\n\n')
    return header + body
  }

  if (name === 'stats') {
    const total = (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE hidden=0').get() as { n: number }).n
    const latest = (
      db.prepare(`SELECT MAX(COALESCE(ended_at,started_at)) AS ts FROM sessions WHERE hidden=0`).get() as {
        ts: string | null
      }
    ).ts
    return `총 세션: ${total}\n최근 활동: ${latest ?? '없음'}`
  }

  return `알 수 없는 도구: ${name}`
}

app.post('/mcp', async (c) => {
  const body = await c.req.json<{ jsonrpc: string; method: string; params?: Record<string, unknown>; id?: unknown }>()
  const { method, params, id } = body

  const ok = (result: unknown) => c.json({ jsonrpc: '2.0', result, id })
  const err = (code: number, message: string) => c.json({ jsonrpc: '2.0', error: { code, message }, id })

  if (method === 'ping') return ok({})

  if (method === 'initialize') {
    return ok({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'chattracker', version: '0.1.0' },
      capabilities: { tools: {} },
    })
  }

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 202 })
  }

  if (method === 'tools/list') {
    return ok({ tools: MCP_TOOLS })
  }

  if (method === 'tools/call') {
    const p = params as { name: string; arguments?: Record<string, unknown> }
    try {
      const text = await executeTool(p.name, p.arguments ?? {})
      return ok({ content: [{ type: 'text', text }] })
    } catch (e) {
      return ok({ content: [{ type: 'text', text: String(e) }], isError: true })
    }
  }

  return err(-32601, `Method not found: ${method}`)
})

// ─── Static ──────────────────────────────────────────────────────────────────

app.get('/swagger', (c) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>chatTracker API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" >
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { padding: 6px 0; }
    .swagger-ui .info    { margin: 12px 0 8px; }
    .swagger-ui .scheme-container { padding: 8px 0; }
    .swagger-ui .opblock { margin: 0 0 6px; }
    .swagger-ui .opblock-summary { padding: 6px 10px; }
    .swagger-ui .opblock-body    { padding: 8px 12px; }
    .swagger-ui section.models   { padding: 8px 0; }
    .swagger-ui .wrapper { padding: 0 12px; }
  </style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({
  url: '/api/openapi.json',
  dom_id: '#swagger-ui',
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
  layout: 'BaseLayout',
  deepLinking: true
})
</script>
</body>
</html>`
  return c.html(html)
})

app.use('/*', serveStatic({ root: join(process.cwd(), 'public') }))

// ─── Boot ────────────────────────────────────────────────────────────────────

loadSettingsFromDb()
startWatcher().then(() => {
  serve({ fetch: app.fetch, port: config.port }, () => {
    console.log(`chatTracker running at http://localhost:${config.port}`)
  })
})
