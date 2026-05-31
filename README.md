# chatTracker

로컬에 저장된 opencode 대화 로그를 SQLite로 인덱싱하고, 웹 UI와 MCP 도구로 검색·조회할 수 있게 하는 **read-only 로컬 서비스**입니다.

---

## 기능

- **웹 UI** — 세션 목록 검색, 날짜 필터, 내용 검색, 마크다운 렌더링, 마크다운 내보내기
- **MCP 서버** — LLM 클라이언트(Claude Code 등)가 직접 호출할 수 있는 5개 도구
- **설정 페이지** — 감시 경로·폴링 간격을 웹 UI에서 변경 (저장 즉시 반영)
- **자동 인덱싱** — 5초 폴링으로 새 파일 감지 후 SQLite upsert
- **API 문서** — `/swagger` (Swagger UI)

---

## 빠른 시작

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:7373` 접속.

---

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `7373` | 서버 포트 |
| `CHATLOG_EXPORTS_DIR` | `~/.local/share/opencode/exports` | 기본 감시 디렉토리 |
| `CHATLOG_EXTRA_DIR` | — | 추가 감시 디렉토리 (선택) |
| `CHATLOG_DB_PATH` | `./data/chatlog.sqlite` | SQLite 파일 경로 |
| `CHATLOG_DEVICE` | `windows` | 세션에 표시될 기기 이름 |
| `CHATLOG_API_TOKEN` | — | MCP Bearer 인증 토큰 (미설정 시 인증 없음) |
| `CHATLOG_POLL_INTERVAL` | `5000` | 파일 감지 폴링 간격 (ms) |

환경변수로 설정한 값은 웹 UI 설정 페이지에서 변경할 수 없습니다 (🔒 고정).  
환경변수가 없는 항목은 설정 페이지에서 변경하면 SQLite에 저장되며 즉시 반영됩니다.

---

## MCP 연결

`claude_desktop_config.json` 또는 openCode MCP 설정에 추가:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./plugins/save-messages.ts"],
  "mcp": {
    "chattracker": {
      "type": "remote",
      "url": "http://localhost:7373/mcp",
      "enabled": true
    }
  }
}

```

또는 HTTP MCP를 지원하는 클라이언트에서 직접:

```
POST http://localhost:7373/mcp
```

### MCP 도구 5개

| 도구 | 설명 |
|---|---|
| `search_sessions` | 키워드로 세션 검색 (제목·세션ID) |
| `list_recent` | 최근 세션 목록 (페이지네이션) |
| `list_projects` | 월별 세션 수·활동 통계 |
| `get_session` | 특정 세션의 전체 메시지 조회 |
| `stats` | 전체 세션 수·최근 활동 시각 |

---

## 구조

```
src/
  config.ts     환경변수 → config 객체
  db.ts         SQLite 초기화 (자동 생성)
  parser.ts     .jsonl 파싱 → 구조화된 메타
  indexer.ts    파일 → SQLite upsert
  watcher.ts    mtime 폴링 → indexer 호출
  settings.ts   설정 로드/저장 (DB ↔ config)
  server.ts     Hono HTTP 서버 (API + MCP + 정적)
public/
  index.html    웹 UI 진입점
  app.js        프론트엔드 로직
  style.css     스타일
  slides.html   활용 예시
data/
  chatlog.sqlite  SQLite DB (자동 생성)
```

**레이어 흐름:**
```
.jsonl / .md 파일
    → Watcher (5초 폴링)
    → Parser → Indexer
    → SQLite
    → HTTP API (Hono)
    → Web UI / MCP 어댑터 → LLM 클라이언트
```

---

## 스택

| 영역 | 사용 |
|---|---|
| 런타임 | Node.js + tsx |
| 언어 | TypeScript |
| HTTP | Hono + @hono/node-server |
| DB | SQLite (better-sqlite3, WAL 모드) |
| 프론트엔드 | Vanilla JS (marked, highlight.js CDN) |

---


