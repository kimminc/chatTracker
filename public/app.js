/* ── marked setup ─────────────────────────────────────────────────────────── */
marked.setOptions({ breaks: true, gfm: true })
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  let hi = text
  if (lang && hljs.getLanguage(lang)) {
    try { hi = hljs.highlight(text, { language: lang }).value } catch {}
  } else {
    try { hi = hljs.highlightAuto(text).value } catch {}
  }
  const label = lang || 'text'
  return `<pre><div class="code-header"><span class="code-lang">${escHtml(label)}</span><button class="copy-btn" onclick="copyCode(this)">복사</button></div><code class="hljs language-${escHtml(label)}">${hi}</code></pre>`
}
marked.use({ renderer })
window.copyCode = btn => {
  const code = btn.closest('pre').querySelector('code')
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.textContent = '복사됨 ✓'; btn.classList.add('copied')
    setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('copied') }, 1800)
  })
}

/* ── Theme ─────────────────────────────────────────────────────────────────── */
const htmlEl = document.documentElement
function applyTheme(t) {
  htmlEl.setAttribute('data-theme', t)
  document.getElementById('hljs-theme').href = t === 'dark'
    ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css'
    : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css'
}
function initTheme() { applyTheme(localStorage.getItem('ct-theme') || 'dark') }
function toggleTheme() {
  const next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  localStorage.setItem('ct-theme', next); applyTheme(next)
}

/* ── Seen tracking (NEW badge) ──────────────────────────────────────────────── */
function getSeenMap() {
  try { return JSON.parse(localStorage.getItem('ct-seen') || '{}') } catch { return {} }
}
function markSeen(id, ended_at) {
  const map = getSeenMap()
  map[id] = ended_at || new Date().toISOString()
  localStorage.setItem('ct-seen', JSON.stringify(map))
}
function isNew(session) {
  const seen = getSeenMap()[session.session_id]
  if (!seen) return true
  return (session.ended_at || session.started_at || '') > seen
}

/* ── Time helpers ──────────────────────────────────────────────────────────── */
function calDayDiff(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sessDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((today - sessDay) / 86400000)
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso), diff = calDayDiff(iso)
  const t = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  if (diff === 0) return t
  if (diff === 1) return `어제 ${t}`
  if (diff <= 6) return `${diff}일 전 ${t}`
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) + ' ' + t
}
function fmtFull(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDur(a, b) {
  if (!a || !b) return null
  const ms = new Date(b) - new Date(a)
  if (ms < 60000) return `${Math.round(ms / 1000)}초`
  if (ms < 3600000) return `${Math.round(ms / 60000)}분`
  return `${(ms / 3600000).toFixed(1)}시간`
}
function groupLabel(iso) {
  if (!iso) return '기타'
  const d = new Date(iso), diff = calDayDiff(iso)
  if (diff === 0) return '오늘'
  if (diff === 1) return '어제'
  if (diff <= 7) return '최근 7일'
  if (diff <= 30) return '최근 30일'
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

/* ── Date query parsing ─────────────────────────────────────────────────────── */
function parseDateQuery(q) {
  const s = q.trim()
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s))
    return { date_from: s, date_to: s + 'T23:59:59Z', textQ: '' }
  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return { date_from: `${s}-01`, date_to: `${s}-${String(last).padStart(2,'0')}T23:59:59Z`, textQ: '' }
  }
  // YYYY
  if (/^\d{4}$/.test(s))
    return { date_from: `${s}-01-01`, date_to: `${s}-12-31T23:59:59Z`, textQ: '' }
  // Korean keywords
  const today = new Date().toISOString().slice(0, 10)
  if (s === '오늘') return { date_from: today, date_to: today + 'T23:59:59Z', textQ: '' }
  if (s === '어제') {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    return { date_from: y, date_to: y + 'T23:59:59Z', textQ: '' }
  }
  if (s === '이번주') {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1)
    return { date_from: d.toISOString().slice(0, 10), date_to: today + 'T23:59:59Z', textQ: '' }
  }
  if (s === '이번달') {
    const d = new Date()
    return { date_from: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, date_to: today + 'T23:59:59Z', textQ: '' }
  }
  return null
}

/* ── State ─────────────────────────────────────────────────────────────────── */
let activeId        = null
let searchTimer     = null
let currentPage     = 1
let totalPages      = 1
let perPage         = 20
let contentMode     = false
let dateFilterOn    = false
let lastRenderedKey = ''

/* ──────────────────────────────────────────────────────────────────────────── *
 * SESSION LIST
 * ──────────────────────────────────────────────────────────────────────────── */
function renderList(data, total, page, pages, silent = false) {
  const el = document.getElementById('session-list')
  currentPage = page; totalPages = pages

  if (silent) {
    const key = data.map(s => `${s.session_id}:${s.message_count}:${s.ended_at}`).join('|')
    if (key === lastRenderedKey) { renderPagination(page, pages, total); return }
    lastRenderedKey = key
  } else {
    lastRenderedKey = ''
  }

  if (!data.length) {
    el.innerHTML = '<div class="spinner">결과 없음</div>'
    document.getElementById('pagination').style.display = 'none'
    return
  }

  const groups = {}
  for (const s of data) {
    const g = groupLabel(s.ended_at || s.started_at)
    ;(groups[g] = groups[g] || []).push(s)
  }

  el.innerHTML = Object.entries(groups).map(([label, items]) => `
    <div class="group-label">${escHtml(label)}</div>
    ${items.map(s => {
      const _new = isNew(s)
      return `
        <div class="session-item${s.session_id === activeId ? ' active' : ''}" data-id="${s.session_id}">
          <div class="s-title-row">
            <div class="s-title">${escHtml(s.display_title || s.session_id)}</div>
            ${_new ? '<span class="new-badge">NEW</span>' : ''}
          </div>
          <div class="s-footer">
            <span class="s-date">${fmtDate(s.ended_at || s.started_at)}</span>
            <span class="s-badge">${s.message_count}개</span>
          </div>
          <button class="delete-btn" data-id="${s.session_id}" title="삭제">✕</button>
        </div>
      `
    }).join('')}
  `).join('')

  bindListEvents(el)
  renderPagination(page, pages, total)
}

function renderContentResults(results) {
  const el = document.getElementById('session-list')
  if (!results.length) {
    el.innerHTML = '<div class="spinner">내용 검색 결과 없음</div>'
    document.getElementById('pagination').style.display = 'none'
    return
  }
  el.innerHTML = `
    <div class="group-label">내용 검색 — ${results.length}건</div>
    ${results.map(s => `
      <div class="session-item${s.session_id === activeId ? ' active' : ''}" data-id="${s.session_id}">
        <div class="s-title-row">
          <div class="s-title">${escHtml(s.display_title || s.session_id)}</div>
          <span class="s-match">${s.match_count}건</span>
        </div>
        <div class="s-footer">
          <span class="s-date">${fmtDate(s.ended_at || s.started_at)}</span>
          <span class="s-badge">${s.message_count}개</span>
        </div>
        ${s.snippets.map(sn => `
          <div class="s-snippet">${escHtml(sn.snippet).replace(
            new RegExp(escHtml(document.getElementById('search').value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'),
            m => `<mark>${m}</mark>`
          )}</div>
        `).join('')}
        <button class="delete-btn" data-id="${s.session_id}" title="삭제">✕</button>
      </div>
    `).join('')}
  `
  bindListEvents(el)
  document.getElementById('pagination').style.display = 'none'
}

function bindListEvents(el) {
  el.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', () => loadSession(item.dataset.id))
  })
  el.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      if (!confirm('이 세션을 삭제(숨김)할까요?')) return
      const id = btn.dataset.id
      await fetch(`/api/sessions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: true }),
      })
      if (activeId === id) {
        activeId = null
        document.getElementById('chat-empty').style.display = 'flex'
        document.getElementById('chat-header').style.display = 'none'
        document.getElementById('chat-messages').style.display = 'none'
        closeSearch()
      }
      triggerSearch()
      loadStats()
    })
  })
}

function renderPagination(page, pages, total) {
  const pgEl = document.getElementById('pagination')
  pgEl.style.display = 'flex'
  document.getElementById('pg-info').textContent = total > 0 ? `${page} / ${pages}` : '0 / 0'
  document.getElementById('pg-prev').disabled = page <= 1
  document.getElementById('pg-next').disabled = page >= pages
  document.getElementById('pg-size').value = String(perPage)
}

/* ── Load sessions (title/date search) ─────────────────────────────────────── */
async function loadSessions(q = '', page = 1, silent = false) {
  const el = document.getElementById('session-list')
  if (!silent) {
    el.innerHTML = '<div class="spinner"><span class="spin">⟳</span> 불러오는 중</div>'
  }

  try {
    // date query detection
    const dateResult = parseDateQuery(q)
    let url = `/api/sessions?per_page=${perPage}&page=${page}`
    if (dateResult) {
      url += `&date_from=${encodeURIComponent(dateResult.date_from)}&date_to=${encodeURIComponent(dateResult.date_to)}`
      if (dateResult.textQ) url += `&q=${encodeURIComponent(dateResult.textQ)}`
    } else if (q) {
      url += `&q=${encodeURIComponent(q)}`
    }

    // manual date filter inputs
    const df = document.getElementById('date-from').value
    const dt = document.getElementById('date-to').value
    if (!dateResult) {
      if (df) url += `&date_from=${encodeURIComponent(df)}`
      if (dt) url += `&date_to=${encodeURIComponent(dt + 'T23:59:59Z')}`
    }

    const { sessions, total, pages } = await (await fetch(url)).json()
    renderList(sessions, total, page, pages, silent)
  } catch (e) {
    if (!silent) {
      el.innerHTML = `<div class="spinner" style="color:var(--text-3)">오류: ${escHtml(e.message)}</div>`
    }
  }
}

/* ── Content search ─────────────────────────────────────────────────────────── */
async function doContentSearch(q) {
  if (!q || q.length < 2) { loadSessions('', 1); return }
  const el = document.getElementById('session-list')
  el.innerHTML = '<div class="spinner"><span class="spin">⟳</span> 내용 검색 중…</div>'
  try {
    const { results } = await (await fetch(`/api/search/content?q=${encodeURIComponent(q)}`)).json()
    renderContentResults(results)
  } catch (e) {
    el.innerHTML = `<div class="spinner" style="color:var(--text-3)">오류: ${escHtml(e.message)}</div>`
  }
}

function triggerSearch() {
  const q = document.getElementById('search').value.trim()
  if (contentMode) {
    doContentSearch(q)
  } else {
    loadSessions(q, 1)
  }
}

async function loadStats() {
  try {
    const s = await (await fetch('/api/stats')).json()
    document.getElementById('topbar-stat').textContent = `세션 ${s.total_sessions}개`
    document.getElementById('stats-bar').textContent = `총 ${s.total_sessions}개 세션`
  } catch {}
}

/* ── Session viewer ────────────────────────────────────────────────────────── */
async function loadSession(id) {
  activeId = id
  closeSearch()

  // mark seen
  const sessEl = document.querySelector(`.session-item[data-id="${id}"]`)
  const endedAt = sessEl ? (sessEl.dataset.endedAt || new Date().toISOString()) : new Date().toISOString()
  markSeen(id, endedAt)

  // remove NEW badge on click
  sessEl?.querySelector('.new-badge')?.remove()

  document.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.id === id))

  document.getElementById('chat-empty').style.display  = 'none'
  document.getElementById('chat-header').style.display = 'block'
  const msgsEl = document.getElementById('chat-messages')
  msgsEl.style.display = 'flex'
  msgsEl.innerHTML = loadingShimmer()
  msgsEl.scrollTop = 0

  try {
    const [meta, messages] = await Promise.all([
      fetch(`/api/sessions/${id}`).then(r => r.json()),
      fetch(`/api/sessions/${id}/messages`).then(r => r.json()),
    ])

    // mark seen with actual ended_at
    markSeen(id, meta.ended_at || meta.started_at)

    document.getElementById('chat-title').textContent = meta.display_title || id
    const dur = fmtDur(meta.started_at, meta.ended_at)
    document.getElementById('chat-pills').innerHTML = [
      `<span class="pill">📅 ${fmtFull(meta.started_at)}</span>`,
      dur ? `<span class="pill">⏱ ${dur}</span>` : '',
      `<span class="pill">💬 ${meta.message_count}개</span>`,
      `<span class="pill pill-id" data-id="${escHtml(meta.session_id)}" title="클릭하여 복사">${escHtml(meta.session_id)}</span>`,
    ].filter(Boolean).join('')

    document.querySelector('.pill-id')?.addEventListener('click', function () {
      navigator.clipboard.writeText(this.dataset.id).then(() => {
        this.textContent = '복사됨 ✓'
        this.classList.add('pill-id--copied')
        setTimeout(() => {
          this.textContent = this.dataset.id
          this.classList.remove('pill-id--copied')
        }, 1600)
      })
    })

    document.getElementById('export-btn').onclick = () => window.open(`/api/sessions/${id}/export`, '_blank')

    if (!messages.length) { msgsEl.innerHTML = '<div class="spinner">메시지 없음</div>'; return }
    msgsEl.innerHTML = messages.map(renderMsg).join('<div class="msg-divider"></div>')
    msgsEl.scrollTop = 0

  } catch (e) {
    msgsEl.innerHTML = `<div class="spinner">오류: ${escHtml(e.message)}</div>`
  }
}

function renderMsg(msg) {
  const isUser = msg.role === 'user'
  const time = msg.timestamp ? fmtFull(msg.timestamp) : ''
  if (isUser) {
    return `<div class="msg-group user">
      <div class="bubble">${escHtml(msg.content).replace(/\n/g,'<br>')}</div>
      ${time ? `<div class="msg-time">${time}</div>` : ''}
    </div>`
  }
  return `<div class="msg-group ai">
    <div class="ai-row">
      <div class="ai-avatar">✦</div>
      <div class="ai-content">
        <div class="ai-label">Assistant</div>
        <div class="bubble md">${marked.parse(msg.content)}</div>
        ${time ? `<div class="msg-time">${time}</div>` : ''}
      </div>
    </div>
  </div>`
}

function loadingShimmer() {
  return `<div class="loading-msg">
    <div class="loading-avatar"></div>
    <div class="loading-lines">
      <div class="loading-line"></div><div class="loading-line"></div><div class="loading-line"></div>
    </div>
  </div>`
}

/* ──────────────────────────────────────────────────────────────────────────── *
 * IN-CHAT SEARCH
 * ──────────────────────────────────────────────────────────────────────────── */
let hlMarks = [], hlIdx = -1

function openSearch() {
  const bar = document.getElementById('chat-search-bar')
  bar.style.display = 'flex'
  document.getElementById('csb-input').focus()
  document.getElementById('csb-input').select()
}
function closeSearch() {
  document.getElementById('chat-search-bar').style.display = 'none'
  document.getElementById('csb-input').value = ''
  clearHighlights()
}
function clearHighlights() {
  document.querySelectorAll('mark.hl').forEach(m => {
    m.parentNode.replaceChild(document.createTextNode(m.textContent), m)
  })
  document.getElementById('chat-messages')?.normalize()
  hlMarks = []; hlIdx = -1; updateCount()
}
function runSearch(query) {
  clearHighlights()
  if (!query.trim()) return
  const container = document.getElementById('chat-messages')
  if (!container) return
  const q = query.toLowerCase()
  const tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p = n.parentElement
      while (p) { if (p.tagName === 'CODE' || p.tagName === 'PRE') return NodeFilter.FILTER_REJECT; p = p.parentElement }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes = []
  let node
  while ((node = tw.nextNode())) nodes.push(node)
  for (const node of nodes) {
    const text = node.textContent, lower = text.toLowerCase()
    if (!lower.includes(q)) continue
    const frag = document.createDocumentFragment()
    let last = 0, idx
    while ((idx = lower.indexOf(q, last)) !== -1) {
      frag.appendChild(document.createTextNode(text.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.className = 'hl'
      mark.textContent = text.slice(idx, idx + query.length)
      frag.appendChild(mark); hlMarks.push(mark)
      last = idx + query.length
    }
    frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode.replaceChild(frag, node)
  }
  if (hlMarks.length) { hlIdx = 0; scrollToMark(0) }
  updateCount()
}
function scrollToMark(idx) {
  hlMarks.forEach((m, i) => m.classList.toggle('current', i === idx))
  hlMarks[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function navSearch(dir) {
  if (!hlMarks.length) return
  hlIdx = (hlIdx + dir + hlMarks.length) % hlMarks.length
  scrollToMark(hlIdx); updateCount()
}
function updateCount() {
  const el = document.getElementById('csb-count')
  if (el) el.textContent = hlMarks.length ? `${hlIdx + 1} / ${hlMarks.length}` : ''
}

/* ──────────────────────────────────────────────────────────────────────────── *
 * SETTINGS PAGE
 * ──────────────────────────────────────────────────────────────────────────── */
function sourceBadge(source, locked) {
  const labels = { env: '환경변수', db: 'DB 저장', default: '기본값' }
  const cls    = { env: 'source-env', db: 'source-db', default: 'source-default' }
  return `
    <span class="source-badge ${cls[source]}">${labels[source]}</span>
    ${locked ? '<span class="source-lock" title="환경변수가 설정되어 있어 변경 불가">🔒 환경변수 고정</span>' : ''}
  `
}

function settingRow(id, label, desc, value, type, placeholder, locked, source, extra = '') {
  return `
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">${escHtml(label)}</div>
        <div class="setting-desc">${escHtml(desc)}</div>
      </div>
      <div class="setting-control">
        <input type="${type}" id="${id}" class="setting-input"
          value="${escHtml(String(value ?? ''))}"
          placeholder="${escHtml(placeholder)}"
          ${locked ? 'disabled' : ''}
          ${extra} />
        <div class="setting-source">${sourceBadge(source, locked)}</div>
      </div>
    </div>
  `
}

function renderSettingsPage(s) {
  const el = document.getElementById('settings-view')
  el.innerHTML = `
    <div class="settings-container">
      <div class="settings-page-header">
        <div class="settings-page-title">설정</div>
        <div class="settings-page-sub">저장 즉시 반영됩니다 · 폴링 간격은 재시작 후 적용</div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">감시 경로</div>
        ${settingRow('s-exports-dir', '기본 감시 경로',
          'opencode 내보내기 파일(.jsonl)이 저장되는 디렉토리',
          s.exports_dir.value, 'text', '', s.exports_dir.locked, s.exports_dir.source)}
        ${settingRow('s-extra-dir', '추가 감시 경로',
          '선택 사항. 마크다운 등 보조 소스 디렉토리 (비워두면 사용 안 함)',
          s.extra_dir.value, 'text', '(없음)', s.extra_dir.locked, s.extra_dir.source)}
      </div>

      <div class="settings-section">
        <div class="settings-section-title">성능</div>
        ${settingRow('s-poll-interval', '폴링 간격 (ms)',
          '파일 변경 감지 주기. 기본 5000ms, 최소 1000ms',
          s.poll_interval.value, 'number', '5000', s.poll_interval.locked, s.poll_interval.source,
          'min="1000" max="60000" step="1000"')}
      </div>

      <div class="settings-actions">
        <div class="settings-msg" id="settings-msg"></div>
        <button class="btn-primary" id="settings-save">저장</button>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">현재 서버 상태</div>
        <div class="settings-status-grid">
          <div class="status-cell">
            <div class="status-cell-label">포트</div>
            <div class="status-cell-value">${location.port || '7373'}</div>
          </div>
          <div class="status-cell">
            <div class="status-cell-label">폴링 간격</div>
            <div class="status-cell-value">${escHtml(String(s.poll_interval.value))}ms</div>
          </div>
          <div class="status-cell">
            <div class="status-cell-label">감시 중인 경로</div>
            <div class="status-cell-value">${escHtml(String(s.exports_dir.value || '-'))}</div>
          </div>
          <div class="status-cell">
            <div class="status-cell-label">추가 경로</div>
            <div class="status-cell-value">${escHtml(String(s.extra_dir.value || '없음'))}</div>
          </div>
        </div>
      </div>
    </div>
  `

  document.getElementById('settings-save').addEventListener('click', saveSettings)
}

async function loadSettings() {
  const el = document.getElementById('settings-view')
  el.innerHTML = '<div class="spinner"><span class="spin">⟳</span> 설정 로드 중</div>'
  try {
    const s = await (await fetch('/api/settings')).json()
    renderSettingsPage(s)
  } catch (e) {
    el.innerHTML = `<div class="spinner" style="color:var(--text-3)">오류: ${escHtml(e.message)}</div>`
  }
}

async function saveSettings() {
  const btn   = document.getElementById('settings-save')
  const msgEl = document.getElementById('settings-msg')

  const fields = {
    exports_dir:   's-exports-dir',
    extra_dir:     's-extra-dir',
    poll_interval: 's-poll-interval',
  }

  const body = {}
  for (const [key, id] of Object.entries(fields)) {
    const el = document.getElementById(id)
    if (el && !el.disabled) body[key] = el.value
  }

  btn.disabled = true
  btn.textContent = '저장 중…'
  msgEl.className = 'settings-msg'
  msgEl.textContent = ''

  try {
    const res  = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.ok) {
      msgEl.className = 'settings-msg success'
      msgEl.textContent = '저장됨 ✓'
      setTimeout(() => loadSettings(), 1200)
    } else {
      throw new Error('서버 오류')
    }
  } catch (e) {
    msgEl.className = 'settings-msg error'
    msgEl.textContent = `오류: ${escHtml(e.message)}`
    btn.disabled = false
    btn.textContent = '저장'
  }
}

/* ── Init ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme)
  document.getElementById('logo-home').addEventListener('click', () => navigateTo('home'))

  /* ── sidebar search ── */
  const searchEl = document.getElementById('search')
  searchEl.addEventListener('input', e => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(triggerSearch, 300)
  })

  /* ── date filter toggle ── */
  document.getElementById('date-filter-toggle').addEventListener('click', () => {
    dateFilterOn = !dateFilterOn
    document.getElementById('date-filter-bar').style.display = dateFilterOn ? 'flex' : 'none'
    document.getElementById('date-filter-toggle').classList.toggle('active', dateFilterOn)
    if (!dateFilterOn) {
      document.getElementById('date-from').value = ''
      document.getElementById('date-to').value = ''
      triggerSearch()
    }
  })
  document.getElementById('date-from').addEventListener('change', triggerSearch)
  document.getElementById('date-to').addEventListener('change', triggerSearch)
  document.getElementById('date-clear').addEventListener('click', () => {
    document.getElementById('date-from').value = ''
    document.getElementById('date-to').value = ''
    triggerSearch()
  })

  /* ── content search toggle ── */
  document.getElementById('content-search-toggle').addEventListener('click', () => {
    contentMode = !contentMode
    document.getElementById('content-search-toggle').classList.toggle('active', contentMode)
    document.getElementById('content-mode-bar').style.display = contentMode ? 'flex' : 'none'
    triggerSearch()
  })

  /* ── pagination ── */
  document.getElementById('pg-prev').addEventListener('click', () => {
    if (currentPage > 1) loadSessions(searchEl.value.trim(), currentPage - 1)
  })
  document.getElementById('pg-next').addEventListener('click', () => {
    if (currentPage < totalPages) loadSessions(searchEl.value.trim(), currentPage + 1)
  })
  document.getElementById('pg-size').addEventListener('change', e => {
    perPage = parseInt(e.target.value)
    loadSessions(searchEl.value.trim(), 1)
  })

  /* ── in-chat search ── */
  document.getElementById('chat-search-toggle').addEventListener('click', () => {
    const bar = document.getElementById('chat-search-bar')
    bar.style.display === 'none' ? openSearch() : closeSearch()
  })
  const csbInput = document.getElementById('csb-input')
  let csbTimer = null
  csbInput.addEventListener('input', e => {
    clearTimeout(csbTimer); csbTimer = setTimeout(() => runSearch(e.target.value), 200)
  })
  csbInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); navSearch(e.shiftKey ? -1 : 1) }
    if (e.key === 'Escape') closeSearch()
  })
  document.getElementById('csb-prev').addEventListener('click', () => navSearch(-1))
  document.getElementById('csb-next').addEventListener('click', () => navSearch(1))
  document.getElementById('csb-close').addEventListener('click', closeSearch)

  /* ── keyboard shortcuts ── */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchEl.focus(); searchEl.select() }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); if (activeId) openSearch() }
    if (e.key === 'Escape') closeSearch()
  })

  /* ── s-title-row flex ── (dynamic style) */
  const style = document.createElement('style')
  style.textContent = `.s-title-row{display:flex;align-items:center;gap:5px;min-width:0}.s-title-row .s-title{flex:1;min-width:0}`
  document.head.appendChild(style)

  loadSessions()
  loadStats()
  setInterval(() => { loadSessions(searchEl.value.trim(), currentPage, true); loadStats() }, 15000)

  /* ── Page navigation ── */
  const mainView = document.getElementById('main-view')
  const FRAMES   = {
    api:    document.getElementById('embed-api'),
    slides: document.getElementById('embed-slides'),
  }
  const PAGE_URLS = { api: '/swagger', slides: '/slides.html' }
  const PAGE_SUBS = { home: '대화 기록 뷰어', api: 'REST API 문서', slides: '소개페이지', settings: '설정' }

  function navigateTo(page) {
    document.querySelectorAll('.left-nav-item').forEach(t =>
      t.classList.toggle('active', t.dataset.page === page))
    document.getElementById('topbar-sub').textContent = PAGE_SUBS[page] || ''

    const settingsView = document.getElementById('settings-view')

    if (page === 'home') {
      mainView.style.display = 'flex'
      settingsView.style.display = 'none'
      Object.values(FRAMES).forEach(f => { f.style.display = 'none' })
    } else if (page === 'settings') {
      mainView.style.display = 'none'
      settingsView.style.display = 'block'
      Object.values(FRAMES).forEach(f => { f.style.display = 'none' })
      loadSettings()
    } else {
      mainView.style.display = 'none'
      settingsView.style.display = 'none'
      Object.entries(FRAMES).forEach(([key, frame]) => {
        if (key === page) {
          frame.style.display = 'block'
          // 최초 한 번만 로드 — 이후 탭 전환 시 재로드 없음
          if (!frame.dataset.loaded) {
            frame.src = PAGE_URLS[key]
            frame.dataset.loaded = '1'
          }
        } else {
          frame.style.display = 'none'
        }
      })
    }
  }

  document.querySelectorAll('.left-nav-item').forEach(btn =>
    btn.addEventListener('click', () => navigateTo(btn.dataset.page)))
})
