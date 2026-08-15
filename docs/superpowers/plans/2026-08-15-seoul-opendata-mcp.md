# Seoul-OpenData-MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 열린데이터광장 Open API를 감싸 도메인별 11개 tool을 공개하는 TypeScript MCP 서버(`seoul-opendata-mcp`)를 npm/MCPB로 배포 가능한 상태까지 구현한다.

**Architecture:** 3층 구조 — `client/`(키 주입·페이지네이션·XML→JSON·TTL 캐시·에러 매핑) → `normalize/`(응답 봉투 4형태를 camelCase 도메인 모델로 변환) → `tools/`(MCP tool 11개, zod 입력 스키마). 장소 해석은 내장 `data/hotspots.json`(121곳) 퍼지 매칭으로 처리한다.

**Tech Stack:** TypeScript(strict, ESM), `@modelcontextprotocol/sdk`(stdio), zod, fast-xml-parser, vitest, tsx

**Spec:** `docs/superpowers/specs/2026-08-14-seoul-opendata-mcp-design.md`

## Global Constraints

- Node >= 18, `"type": "module"`, TypeScript strict 모드
- 외부 HTTP 호출은 `SeoulApiClient` 경유만 — tool 코드에서 `fetch` 직접 호출 금지
- 모든 tool 응답은 공통 봉투 `{ data, asOf, source, notes }`의 JSON 텍스트
- 인증키는 로그·에러 메시지에 노출 금지 (`maskKey()` 경유)
- 단위 테스트는 네트워크 금지(픽스처 + fetchFn 주입). 라이브 테스트는 `RUN_LIVE=1`일 때만
- API 에러 코드: `INFO-000` 정상, `INFO-200` 데이터 없음(빈 결과 + note, 에러 아님), 그 외 `SeoulApiError` throw
- 무료 쿼터 보호: 서비스별 TTL 캐시 필수 (citydata 계열 60s / 따릉이·주차·대기질 300s / 문화행사 3600s / 지하철 15s)
- 커밋 컨벤션: `feat:` `test:` `docs:` `chore:`
- tool description은 영어 1문장(언제 쓰는가) + 한국어 병기

## File Structure

```
package.json / tsconfig.json / vitest.config.ts / .gitignore / LICENSE
src/
  index.ts                 # 서버 조립 + stdio (Task 13)
  client/
    cache.ts               # TtlCache (Task 3)
    response.ts            # unwrap() 봉투 4형태 + SeoulApiError (Task 2)
    seoulApi.ts            # SeoulApiClient (Task 3)
  data/
    hotspots.ts            # 121곳: name/category/commercial (Task 4)
    placeMatcher.ts        # searchPlace() 퍼지 매칭 (Task 4)
  normalize/
    util.ts                # toArray/num (Task 2)
    population.ts          # (Task 5)  commercial.ts (Task 6)  subway.ts (Task 7)
    bike.ts                # (Task 8)  parking.ts (Task 9)     citydata.ts (Task 10)
    culture.ts             # (Task 11) air.ts (Task 12)
  tools/
    envelope.ts            # ok()/fail() 봉투 헬퍼 (Task 4)
    context.ts             # Ctx 타입 (Task 4)
    resolve.ts             # resolvePlace() (Task 5)
    common.ts              # search_place (Task 4), get_city_snapshot (Task 10)
    population.ts          # get_population (5), get_commercial_activity (6)
    traffic.ts             # get_subway_arrivals (7), get_bike_stations (8), get_parking (9), get_road_traffic (10)
    culture.ts             # search_cultural_events (11)
    environment.ts         # get_air_quality (12), get_weather (10)
tests/                     # 파일당 대응 *.test.ts, fixtures/*.json
scripts/capture-fixtures.ts  # 샘플 키 실응답 캡처 (Task 2)
manifest.json              # MCPB 번들 (Task 15)
```

각 태스크의 테스트는 2026-08-14(project 시작 시점) 샘플 키 실호출로 확보한 실제 응답 조각을 픽스처로 사용한다(스펙 §2). 필드명이 픽스처와 다르면 **픽스처가 정답** — 정규화 코드를 픽스처에 맞춘다.

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts`(임시), `tests/smoke.test.ts`

**Interfaces:**
- Produces: 빌드/테스트 파이프라인 (`npm run build`, `npm test`), ESM + strict TS 기반

- [ ] **Step 1: 파일 생성**

`package.json`:
```json
{
  "name": "seoul-opendata-mcp",
  "version": "0.1.0",
  "description": "MCP server for Seoul Open Data Plaza real-time city APIs (서울 열린데이터광장 실시간 도시데이터 MCP 서버)",
  "type": "module",
  "license": "MIT",
  "bin": { "seoul-opendata-mcp": "dist/index.js" },
  "main": "dist/index.js",
  "files": ["dist", "README.md", "README.ko.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "keywords": ["mcp", "model-context-protocol", "seoul", "open-data", "korea"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "inspect": "npx @modelcontextprotocol/inspector tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.0",
    "fast-xml-parser": "^5.2.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })
```

`.gitignore`:
```
node_modules/
dist/
*.mcpb
.env
```

`src/index.ts` (임시 — Task 13에서 교체):
```ts
#!/usr/bin/env node
export const SERVER_NAME = 'seoul-opendata-mcp'
```

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SERVER_NAME } from '../src/index.js'

describe('scaffold', () => {
  it('exports server name', () => {
    expect(SERVER_NAME).toBe('seoul-opendata-mcp')
  })
})
```

- [ ] **Step 2: 설치 및 검증**

Run: `npm install && npm run build && npm test`
Expected: 빌드 성공, 1 test PASS. (`@modelcontextprotocol/sdk` 최신 1.x가 zod 버전과 충돌하면 npm 에러 메시지에 맞춰 zod를 SDK peerDependency 범위로 조정)

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold TypeScript MCP server project"
```

---

### Task 2: 응답 봉투 unwrap + 에러 매핑

**Files:**
- Create: `src/client/response.ts`, `src/normalize/util.ts`, `tests/response.test.ts`, `scripts/capture-fixtures.ts`

**Interfaces:**
- Produces:
  - `class SeoulApiError extends Error { code: string }`
  - `interface Unwrapped { rows: any[]; totalCount: number; raw: any; note?: string }`
  - `function unwrap(service: string, payload: any): Unwrapped` — 봉투 4형태 + 에러코드 처리
  - `normalize/util.ts`: `toArray(v: any): any[]`, `num(v: any): number | null`, `KEY_GUIDE: string`

- [ ] **Step 1: Write the failing test**

`tests/response.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { unwrap, SeoulApiError } from '../src/client/response.js'

const standard = { bikeList: { list_total_count: 5, RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' }, row: [{ stationName: '102. 망원역 1번출구 앞' }] } }
const ppltn = { 'SeoulRtd.citydata_ppltn': [{ AREA_NM: '광화문·덕수궁', AREA_CONGEST_LVL: '여유' }] }
const cmrcl = { list_total_count: 3, LIVE_CMRCL_STTS: { AREA_CMRCL_LVL: '한산한', CMRCL_RSB: [] } }
const subway = { errorMessage: { status: 200, code: 'INFO-000', message: '정상 처리되었습니다.', total: 7 }, realtimeArrivalList: [{ subwayId: '1002' }] }
const citydataXml = { 'SeoulRtd.citydata': { RESULT: { 'RESULT.CODE': 'INFO-000' }, CITYDATA: { AREA_NM: '광화문·덕수궁' } } }
const keyError = { RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } }
const noData = { culturalEventInfo: { list_total_count: 0, RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } } }

describe('unwrap', () => {
  it('standard 봉투: row 배열 반환', () => {
    const u = unwrap('bikeList', standard)
    expect(u.rows).toHaveLength(1)
    expect(u.totalCount).toBe(5)
  })
  it('citydata_ppltn: 루트 배열 반환', () => {
    expect(unwrap('citydata_ppltn', ppltn).rows[0].AREA_CONGEST_LVL).toBe('여유')
  })
  it('citydata_cmrcl: LIVE_CMRCL_STTS 단일 객체를 rows[0]로', () => {
    expect(unwrap('citydata_cmrcl', cmrcl).rows[0].AREA_CMRCL_LVL).toBe('한산한')
  })
  it('subway: realtimeArrivalList 반환', () => {
    expect(unwrap('realtimeStationArrival', subway).rows[0].subwayId).toBe('1002')
  })
  it('citydata XML: CITYDATA 객체를 rows[0]로', () => {
    expect(unwrap('citydata', citydataXml).rows[0].AREA_NM).toBe('광화문·덕수궁')
  })
  it('INFO-200은 빈 rows + note (에러 아님)', () => {
    const u = unwrap('culturalEventInfo', noData)
    expect(u.rows).toHaveLength(0)
    expect(u.note).toContain('데이터가 없습니다')
  })
  it('키 오류는 SeoulApiError(발급 안내 포함)', () => {
    expect(() => unwrap('bikeList', keyError)).toThrowError(SeoulApiError)
    try { unwrap('bikeList', keyError) } catch (e: any) {
      expect(e.code).toBe('INFO-100')
      expect(e.message).toContain('data.seoul.go.kr')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/response.test.ts`
Expected: FAIL — `Cannot find module '../src/client/response.js'`

- [ ] **Step 3: 구현**

`src/normalize/util.ts`:
```ts
export const toArray = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v])

export const num = (v: any): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export const KEY_GUIDE =
  '인증키 무료 발급: https://data.seoul.go.kr → 로그인 → 인증키 신청 (5분 소요)'
```

`src/client/response.ts`:
```ts
import { toArray, KEY_GUIDE } from '../normalize/util.js'

export class SeoulApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'SeoulApiError'
  }
}

export interface Unwrapped {
  rows: any[]
  totalCount: number
  raw: any
  note?: string
}

const pickResult = (o: any) =>
  o?.RESULT ?? o?.errorMessage ?? null

const codeOf = (r: any): string | null =>
  r == null ? null : (r.CODE ?? r['RESULT.CODE'] ?? r.code ?? null)

const msgOf = (r: any): string =>
  r == null ? '' : (r.MESSAGE ?? r['RESULT.MESSAGE'] ?? r.message ?? '')

function assertOk(service: string, result: any): string | undefined {
  const code = codeOf(result)
  if (code == null || code === 'INFO-000') return undefined
  if (code === 'INFO-200') return `해당하는 데이터가 없습니다 (${service})`
  const hint = /키|KEY/i.test(msgOf(result)) || code === 'INFO-100' ? ` — ${KEY_GUIDE}` : ''
  throw new SeoulApiError(code, `서울 열린데이터광장 API 오류 [${code}] ${msgOf(result)}${hint}`)
}

export function unwrap(service: string, payload: any): Unwrapped {
  // 형태 A: 최상위 RESULT만 있는 에러 응답
  if (payload?.RESULT && Object.keys(payload).length === 1) {
    const note = assertOk(service, payload.RESULT)
    return { rows: [], totalCount: 0, raw: payload, note }
  }
  // 형태 B: 지하철 swopenapi — { errorMessage, realtimeArrivalList }
  if (payload?.errorMessage) {
    const note = assertOk(service, payload.errorMessage)
    const rows = toArray(payload.realtimeArrivalList)
    return { rows, totalCount: payload.errorMessage.total ?? rows.length, raw: payload, note }
  }
  // 형태 C: citydata_ppltn — { "SeoulRtd.citydata_ppltn": [...] }
  if (payload?.['SeoulRtd.citydata_ppltn']) {
    const rows = toArray(payload['SeoulRtd.citydata_ppltn'])
    return { rows, totalCount: rows.length, raw: payload }
  }
  // 형태 D: citydata_cmrcl — { list_total_count, LIVE_CMRCL_STTS: {...} }
  if (payload?.LIVE_CMRCL_STTS) {
    const note = assertOk(service, pickResult(payload))
    return { rows: [payload.LIVE_CMRCL_STTS], totalCount: 1, raw: payload, note }
  }
  // 형태 E: citydata 통합(XML 파싱 결과) — { "SeoulRtd.citydata": { RESULT, CITYDATA } }
  if (payload?.['SeoulRtd.citydata']) {
    const body = payload['SeoulRtd.citydata']
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.CITYDATA), totalCount: 1, raw: payload, note }
  }
  // 형태 F: 표준 — { [service]: { list_total_count, RESULT, row } }
  const body = payload?.[service]
  if (body) {
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.row), totalCount: body.list_total_count ?? 0, raw: payload, note }
  }
  throw new SeoulApiError('PARSE', `알 수 없는 응답 형태 (${service}): ${JSON.stringify(payload).slice(0, 200)}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/response.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: 픽스처 캡처 스크립트 작성 (테스트용 실응답 확보)**

`scripts/capture-fixtures.ts`:
```ts
// 샘플 키로 실응답을 tests/fixtures/에 저장한다. 실행: npx tsx scripts/capture-fixtures.ts
import { writeFileSync, mkdirSync } from 'node:fs'

const PLACE = encodeURIComponent('광화문·덕수궁')
const targets: Record<string, string> = {
  'ppltn.json': `http://openapi.seoul.go.kr:8088/sample/json/citydata_ppltn/1/5/${PLACE}`,
  'cmrcl.json': `http://openapi.seoul.go.kr:8088/sample/json/citydata_cmrcl/1/5/${PLACE}`,
  'citydata.xml': `http://openapi.seoul.go.kr:8088/sample/xml/citydata/1/5/${PLACE}`,
  'bike.json': 'http://openapi.seoul.go.kr:8088/sample/json/bikeList/1/5/',
  'culture.json': 'http://openapi.seoul.go.kr:8088/sample/json/culturalEventInfo/1/5/',
  'parking.json': 'http://openapi.seoul.go.kr:8088/sample/json/GetParkingInfo/1/5/',
  'air.json': 'http://openapi.seoul.go.kr:8088/sample/json/RealtimeCityAir/1/5/',
  'subway.json': `http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimeStationArrival/0/5/${encodeURIComponent('강남')}`,
}

mkdirSync('tests/fixtures', { recursive: true })
for (const [file, url] of Object.entries(targets)) {
  const res = await fetch(url)
  writeFileSync(`tests/fixtures/${file}`, await res.text())
  console.log(`saved tests/fixtures/${file} (${res.status})`)
}
```

Run: `npx tsx scripts/capture-fixtures.ts`
Expected: 8개 파일 저장, 전부 200. 각 파일을 열어 `INFO-000` 확인.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: response unwrap for 4 envelope shapes + error mapping, capture live fixtures"
```

---

### Task 3: TtlCache + SeoulApiClient

**Files:**
- Create: `src/client/cache.ts`, `src/client/seoulApi.ts`, `tests/seoulApi.test.ts`

**Interfaces:**
- Consumes: `unwrap`, `SeoulApiError` (Task 2)
- Produces:
  - `class TtlCache { get(k: string): any | undefined; set(k: string, v: any, ttlMs: number): void }`
  - `interface ClientOptions { apiKey?: string; fetchFn?: typeof fetch; timeoutMs?: number; now?: () => number }`
  - `class SeoulApiClient`:
    - `readonly isSample: boolean`
    - `maskedKey(): string`
    - `getJson(service: string, start: number, end: number, path?: string[]): Promise<Unwrapped>`
    - `getXml(service: string, start: number, end: number, path?: string[]): Promise<Unwrapped>`
    - `getSubway(service: string, start: number, end: number, path?: string[]): Promise<Unwrapped>`
    - `fetchAll(service: string, opts: { max: number; pageSize?: number; path?: string[] }): Promise<any[]>`

- [ ] **Step 1: Write the failing test**

`tests/seoulApi.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { SeoulApiClient } from '../src/client/seoulApi.js'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const standardPage = (rows: any[], total: number) =>
  jsonResponse({ bikeList: { list_total_count: total, RESULT: { CODE: 'INFO-000', MESSAGE: 'ok' }, row: rows } })

describe('SeoulApiClient', () => {
  it('키 미설정 시 sample 폴백 + isSample=true', () => {
    delete process.env.SEOUL_API_KEY
    const c = new SeoulApiClient({ fetchFn: vi.fn() as any })
    expect(c.isSample).toBe(true)
  })

  it('URL을 {base}/{key}/{type}/{service}/{start}/{end}/{path...}로 조립하고 경로를 인코딩한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ 'SeoulRtd.citydata_ppltn': [{ AREA_NM: '강남역' }] }))
    const c = new SeoulApiClient({ apiKey: 'MYKEY', fetchFn: fetchFn as any })
    await c.getJson('citydata_ppltn', 1, 5, ['강남역'])
    const url: string = fetchFn.mock.calls[0][0]
    expect(url).toBe(`http://openapi.seoul.go.kr:8088/MYKEY/json/citydata_ppltn/1/5/${encodeURIComponent('강남역')}`)
  })

  it('동일 URL 재호출은 TTL 내 캐시를 사용한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    await c.getJson('bikeList', 1, 5)
    await c.getJson('bikeList', 1, 5)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('fetchAll은 pageSize 단위로 totalCount까지 순회해 병합한다', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(standardPage([{ i: 1 }, { i: 2 }], 5))
      .mockResolvedValueOnce(standardPage([{ i: 3 }, { i: 4 }], 5))
      .mockResolvedValueOnce(standardPage([{ i: 5 }], 5))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const rows = await c.fetchAll('bikeList', { max: 10, pageSize: 2 })
    expect(rows.map(r => r.i)).toEqual([1, 2, 3, 4, 5])
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('HTTP 5xx는 1회 재시도 후 성공하면 정상 반환', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toHaveLength(1)
  })

  it('에러 메시지에서 키가 마스킹된다', () => {
    const c = new SeoulApiClient({ apiKey: 'SECRETKEY123', fetchFn: vi.fn() as any })
    expect(c.maskedKey()).toBe('SECR…(masked)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/seoulApi.test.ts`
Expected: FAIL — `Cannot find module '../src/client/seoulApi.js'`

- [ ] **Step 3: 구현**

`src/client/cache.ts`:
```ts
export class TtlCache {
  private store = new Map<string, { value: any; expiresAt: number }>()
  constructor(private now: () => number = Date.now) {}

  get(key: string): any | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expiresAt < this.now()) { this.store.delete(key); return undefined }
    return hit.value
  }

  set(key: string, value: any, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs })
  }
}
```

`src/client/seoulApi.ts`:
```ts
import { XMLParser } from 'fast-xml-parser'
import { TtlCache } from './cache.js'
import { unwrap, SeoulApiError, type Unwrapped } from './response.js'

const OPEN_BASE = 'http://openapi.seoul.go.kr:8088'
const SUBWAY_BASE = 'http://swopenapi.seoul.go.kr/api/subway'

// 데이터 갱신 주기에 맞춘 캐시 TTL(ms) — Global Constraints 참조
const TTL: Record<string, number> = {
  citydata: 60_000, citydata_ppltn: 60_000, citydata_cmrcl: 60_000,
  bikeList: 300_000, GetParkingInfo: 300_000, RealtimeCityAir: 300_000,
  culturalEventInfo: 3_600_000, realtimeStationArrival: 15_000,
}

export interface ClientOptions {
  apiKey?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

export class SeoulApiClient {
  readonly isSample: boolean
  private key: string
  private fetchFn: typeof fetch
  private timeoutMs: number
  private cache: TtlCache
  private xml = new XMLParser({ ignoreDeclaration: true })

  constructor(opts: ClientOptions = {}) {
    this.key = opts.apiKey ?? process.env.SEOUL_API_KEY ?? 'sample'
    this.isSample = this.key === 'sample'
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.cache = new TtlCache(opts.now)
  }

  maskedKey(): string {
    return this.isSample ? 'sample' : `${this.key.slice(0, 4)}…(masked)`
  }

  private buildUrl(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): string {
    const segs = [this.key, type, service, String(start), String(end), ...path.map(encodeURIComponent)]
    return `${base}/${segs.join('/')}`
  }

  private async request(url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) })
        if (res.status >= 500 && attempt === 0) continue
        if (!res.ok) throw new SeoulApiError(`HTTP-${res.status}`, `HTTP ${res.status} (key=${this.maskedKey()})`)
        return await res.text()
      } catch (e) {
        if (e instanceof SeoulApiError) throw e
        if (attempt === 0) continue // 네트워크 오류 1회 재시도
        throw new SeoulApiError('NETWORK', `네트워크 오류: ${(e as Error).message} (key=${this.maskedKey()})`)
      }
    }
  }

  private async fetchUnwrapped(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): Promise<Unwrapped> {
    const url = this.buildUrl(base, type, service, start, end, path)
    const cached = this.cache.get(url)
    if (cached) return cached
    const text = await this.request(url)
    const payload = type === 'xml' ? this.xml.parse(text) : JSON.parse(text)
    const result = unwrap(service, payload)
    this.cache.set(url, result, TTL[service] ?? 60_000)
    return result
  }

  getJson(service: string, start: number, end: number, path: string[] = []) {
    return this.fetchUnwrapped(OPEN_BASE, 'json', service, start, end, path)
  }
  getXml(service: string, start: number, end: number, path: string[] = []) {
    return this.fetchUnwrapped(OPEN_BASE, 'xml', service, start, end, path)
  }
  getSubway(service: string, start: number, end: number, path: string[] = []) {
    return this.fetchUnwrapped(SUBWAY_BASE, 'json', service, start, end, path)
  }

  /** 표준 봉투 서비스의 페이지를 totalCount 또는 max까지 자동 순회 병합 */
  async fetchAll(service: string, opts: { max: number; pageSize?: number; path?: string[] }): Promise<any[]> {
    const pageSize = opts.pageSize ?? 1000
    const rows: any[] = []
    for (let start = 1; rows.length < opts.max; start += pageSize) {
      const u = await this.getJson(service, start, Math.min(start + pageSize - 1, opts.max), opts.path ?? [])
      rows.push(...u.rows)
      if (rows.length >= u.totalCount || u.rows.length === 0) break
    }
    return rows.slice(0, opts.max)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/seoulApi.test.ts`
Expected: 6 tests PASS. (전체도 확인: `npm test`)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: SeoulApiClient with key fallback, TTL cache, pagination, retry"
```

---

### Task 4: 핫스팟 데이터 + 퍼지 매칭 + `search_place` tool

**Files:**
- Create: `src/data/hotspots.ts`, `src/data/placeMatcher.ts`, `src/tools/envelope.ts`, `src/tools/context.ts`, `src/tools/common.ts`, `tests/placeMatcher.test.ts`

**Interfaces:**
- Consumes: `SeoulApiClient` (Task 3, context 타입에만)
- Produces:
  - `interface Hotspot { name: string; category: Category; commercial: boolean }` / `const HOTSPOTS: Hotspot[]` (121개)
  - `function searchPlace(query: string): { match: Hotspot | null; candidates: Hotspot[] }`
  - `interface Ctx { client: SeoulApiClient }` (`src/tools/context.ts`)
  - `envelope.ts`: `ok(data: unknown, opts: { source: string; asOf?: string | null; notes?: string[]; sample?: boolean })` / `fail(message: string)` — 둘 다 MCP tool 반환형 `{ content: [{ type: 'text', text: string }], isError? }`
  - `function registerCommonTools(server: McpServer, ctx: Ctx): void` — `search_place` 등록 (`get_city_snapshot`은 Task 10에서 이 파일에 추가)

- [ ] **Step 1: Write the failing test**

`tests/placeMatcher.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { HOTSPOTS } from '../src/data/hotspots.js'
import { searchPlace } from '../src/data/placeMatcher.js'

describe('HOTSPOTS 데이터', () => {
  it('정확히 121곳', () => expect(HOTSPOTS).toHaveLength(121))
  it('상권 지원은 정확히 82곳', () => expect(HOTSPOTS.filter(h => h.commercial)).toHaveLength(82))
  it('카테고리별 개수: 고궁5/특구7/공원33/상권28/밀집48', () => {
    const count = (c: string) => HOTSPOTS.filter(h => h.category === c).length
    expect(count('고궁·문화유산')).toBe(5)
    expect(count('관광특구')).toBe(7)
    expect(count('공원')).toBe(33)
    expect(count('발달상권')).toBe(28)
    expect(count('인구밀집지역')).toBe(48)
  })
})

describe('searchPlace', () => {
  it('정확 일치', () => expect(searchPlace('강남역').match?.name).toBe('강남역'))
  it('중점(·)/공백 무시', () => expect(searchPlace('광화문 덕수궁').match?.name).toBe('광화문·덕수궁'))
  it('별칭: 코엑스 → 강남 MICE 관광특구', () =>
    expect(searchPlace('코엑스').match?.name).toBe('강남 MICE 관광특구'))
  it('별칭: 롯데타워 → 잠실롯데타워·석촌호수', () =>
    expect(searchPlace('롯데타워').match?.name).toBe('잠실롯데타워·석촌호수'))
  it('모호한 질의(홍대)는 match=null + 후보 2개 이상', () => {
    const r = searchPlace('홍대')
    expect(r.match).toBeNull()
    expect(r.candidates.length).toBeGreaterThanOrEqual(2)
    expect(r.candidates.map(c => c.name)).toContain('홍대 관광특구')
  })
  it('유일 부분일치는 match 확정: 서울숲', () =>
    expect(searchPlace('서울숲').match?.name).toBe('서울숲공원'))
  it('불일치 시 match=null + 후보 제안', () => {
    const r = searchPlace('강남스타일거리')
    expect(r.match).toBeNull()
    expect(r.candidates.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/placeMatcher.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: hotspots 데이터 구현**

`src/data/hotspots.ts` — 매뉴얼 V8.5 표 2-2(121곳)·표 3-9(상권 82곳) 기반. **이름 문자열은 아래 그대로 복사할 것**(중점 `·` 포함):
```ts
export type Category = '고궁·문화유산' | '관광특구' | '공원' | '발달상권' | '인구밀집지역'
export interface Hotspot { name: string; category: Category; commercial: boolean }

const PALACE = ['경복궁', '광화문·덕수궁', '보신각', '서울 암사동 유적', '창덕궁·종묘']
const ZONE = ['강남 MICE 관광특구', '동대문 관광특구', '명동 관광특구', '이태원 관광특구', '잠실 관광특구', '종로·청계 관광특구', '홍대 관광특구']
const PARK = ['강서한강공원', '고척돔', '광나루한강공원', '광화문광장', '국립중앙박물관·용산가족공원', '난지한강공원', '남산공원', '노들섬', '뚝섬한강공원', '망원한강공원', '반포한강공원', '보라매공원', '북서울꿈의숲', '서대문독립공원', '서리풀공원·몽마르뜨공원', '서울대공원', '서울숲공원', '송현녹지광장', '아차산', '안양천', '양화한강공원', '어린이대공원', '여의도한강공원', '여의서로', '올림픽공원', '월드컵공원', '응봉산', '이촌한강공원', '잠실종합운동장', '잠실한강공원', '잠원한강공원', '청계산', '홍제폭포']
const MARKET = ['가락시장', '가로수길', '광장(전통)시장', '김포공항', '남대문시장', '노량진', '덕수궁길·정동길', '북창동 먹자골목', '북촌한옥마을', '서촌', '성수카페거리', '송리단길·호수단길', '신촌 스타광장', '압구정로데오거리', '여의도', '연남동', '영등포 타임스퀘어', '용리단길', '이태원 앤틱가구거리', '익선동', '인사동', '잠실롯데타워·석촌호수', '창동 신경제 중심지', '청담동 명품거리', '청량리 제기동 일대 전통시장', '해방촌·경리단길', 'DDP(동대문디자인플라자)', 'DMC(디지털미디어시티)']
const DENSE = ['가산디지털단지역', '강남역', '건대입구역', '고덕역', '고속터미널역', '교대역', '구로디지털단지역', '구로역', '군자역', '대림역', '동대문역', '뚝섬역', '미아사거리역', '발산역', '사당역', '삼각지역', '서울대입구역', '서울식물원·마곡나루역', '서울역', '선릉역', '성신여대입구역', '수유역', '숭례문', '시의회 앞', '신논현역·논현역', '신도림역', '신림역', '신정네거리역', '신촌·이대역', '쌍문역', '양재역', '역삼역', '연신내역', '오목교역·목동운동장', '왕십리역', '용산역', '이태원역', '잠실새내역', '잠실역', '장지역', '장한평역', '천호역', '총신대입구(이수)역', '충정로역', '합정역', '혜화역', '홍대입구역(2호선)', '회기역']

// 상권(citydata_cmrcl) 미지원 39곳 = 공원 33 + 고궁 3 + 인구밀집 3 (표 3-9의 여집합)
const NON_COMMERCIAL = new Set([...PARK, '경복궁', '서울 암사동 유적', '창덕궁·종묘', '삼각지역', '숭례문', '시의회 앞'])

const build = (names: string[], category: Category): Hotspot[] =>
  names.map(name => ({ name, category, commercial: !NON_COMMERCIAL.has(name) }))

export const HOTSPOTS: Hotspot[] = [
  ...build(PALACE, '고궁·문화유산'),
  ...build(ZONE, '관광특구'),
  ...build(PARK, '공원'),
  ...build(MARKET, '발달상권'),
  ...build(DENSE, '인구밀집지역'),
]
```

- [ ] **Step 4: placeMatcher 구현**

`src/data/placeMatcher.ts`:
```ts
import { HOTSPOTS, type Hotspot } from './hotspots.js'

// 자주 쓰는 통칭 → 정식 핫스팟명 (정규화된 키로 조회)
const ALIASES: Record<string, string> = {
  '코엑스': '강남 MICE 관광특구', 'coex': '강남 MICE 관광특구',
  '롯데타워': '잠실롯데타워·석촌호수', '롯데월드': '잠실롯데타워·석촌호수', '석촌호수': '잠실롯데타워·석촌호수',
  '동대문디자인플라자': 'DDP(동대문디자인플라자)', 'ddp': 'DDP(동대문디자인플라자)',
  '디지털미디어시티': 'DMC(디지털미디어시티)', 'dmc': 'DMC(디지털미디어시티)',
  '광화문': '광화문·덕수궁', '덕수궁': '광화문·덕수궁', '경리단길': '해방촌·경리단길',
  '가로수길': '가로수길', '광장시장': '광장(전통)시장', '북촌': '북촌한옥마을',
  '홍대입구': '홍대입구역(2호선)', '홍대입구역': '홍대입구역(2호선)',
  '이수역': '총신대입구(이수)역', '총신대입구역': '총신대입구(이수)역',
  '마곡나루역': '서울식물원·마곡나루역', '서울식물원': '서울식물원·마곡나루역',
  '송리단길': '송리단길·호수단길', '신촌역': '신촌·이대역', '이대역': '신촌·이대역',
  '잠실야구장': '잠실종합운동장', '석촌': '잠실롯데타워·석촌호수',
  'gangnam': '강남역', 'hongdae': '홍대 관광특구', 'myeongdong': '명동 관광특구', 'itaewon': '이태원 관광특구',
}

/** 소문자화, 공백/중점/괄호/하이픈 제거 */
export const normalizeQuery = (q: string): string =>
  q.toLowerCase().replace(/[\s·()\-]/g, '')

const byName = new Map(HOTSPOTS.map(h => [normalizeQuery(h.name), h]))

/** 2-gram 겹침 점수 (후보 제안용) */
const bigrams = (s: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}
const overlap = (a: string, b: string): number => {
  const A = bigrams(a), B = bigrams(b)
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / Math.max(A.size, 1)
}

export function searchPlace(query: string): { match: Hotspot | null; candidates: Hotspot[] } {
  const q = normalizeQuery(query)
  if (!q) return { match: null, candidates: [] }

  const exact = byName.get(q)
  if (exact) return { match: exact, candidates: [] }

  const alias = ALIASES[q]
  if (alias) return { match: byName.get(normalizeQuery(alias)) ?? null, candidates: [] }

  // 부분일치: 질의⊂이름 또는 이름⊂질의
  const partial = HOTSPOTS.filter(h => {
    const n = normalizeQuery(h.name)
    return n.includes(q) || q.includes(n)
  })
  if (partial.length === 1) return { match: partial[0], candidates: [] }
  if (partial.length > 1) return { match: null, candidates: partial.slice(0, 5) }

  // 유사도 상위 후보 제안
  const scored = HOTSPOTS
    .map(h => ({ h, s: overlap(q, normalizeQuery(h.name)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
  return { match: null, candidates: scored.slice(0, 5).map(x => x.h) }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/placeMatcher.test.ts`
Expected: 10 tests PASS. 개수 테스트가 실패하면 배열에서 빠진/중복된 이름을 스펙 §2와 매뉴얼 표 기준으로 교정.

- [ ] **Step 6: envelope 헬퍼 + search_place tool 등록**

`src/tools/context.ts`:
```ts
import type { SeoulApiClient } from '../client/seoulApi.js'
export interface Ctx { client: SeoulApiClient }
```

`src/tools/envelope.ts`:
```ts
import { KEY_GUIDE } from '../normalize/util.js'

const SAMPLE_NOTE = `샘플 키 사용 중 — citydata 계열은 광화문·덕수궁만, 일반 API는 5행만 조회됩니다. ${KEY_GUIDE}`

export function ok(data: unknown, opts: { source: string; asOf?: string | null; notes?: string[]; sample?: boolean }) {
  const notes = [...(opts.notes ?? [])]
  if (opts.sample) notes.push(SAMPLE_NOTE)
  const body = { data, asOf: opts.asOf ?? new Date().toISOString(), source: opts.source, notes }
  return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 1) }] }
}

export function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}
```

`src/tools/common.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { searchPlace } from '../data/placeMatcher.js'
import { HOTSPOTS } from '../data/hotspots.js'

export function registerCommonTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_place',
    {
      title: 'Search Seoul hotspot places',
      description:
        'Resolve a free-form place name to one of Seoul\'s 121 official real-time hotspots. Use FIRST when the user mentions a Seoul location. ' +
        '자연어 장소명을 서울 실시간 도시데이터 핫스팟 121곳에 매칭합니다.',
      inputSchema: {
        query: z.string().describe('장소명 (예: "강남역", "홍대", "코엑스", "Gangnam")'),
      },
    },
    async ({ query }) => {
      const { match, candidates } = searchPlace(query)
      return ok(
        {
          match,
          candidates,
          totalHotspots: HOTSPOTS.length,
          hint: match
            ? undefined
            : candidates.length
              ? '여러 후보가 있습니다. 사용자 의도에 맞는 name을 골라 다른 tool의 place 인자로 쓰세요.'
              : '일치하는 핫스팟이 없습니다. 실시간 데이터는 121개 주요 장소만 지원합니다.',
        },
        { source: 'built-in hotspots.ts (매뉴얼 V8.5 표 2-2)', sample: ctx.client.isSample },
      )
    },
  )
}
```

- [ ] **Step 7: 전체 테스트 + 커밋**

Run: `npm test && npm run build`
Expected: 전부 PASS, 빌드 성공

```bash
git add -A && git commit -m "feat: 121 hotspots data, fuzzy place matcher, search_place tool"
```

---

### Task 5: 인구 정규화 + `get_population`

**Files:**
- Create: `src/normalize/population.ts`, `src/tools/resolve.ts`, `src/tools/population.ts`, `tests/population.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `ok`/`fail`, `searchPlace`, `client.getJson`, `num`/`toArray`
- Produces:
  - `interface PopulationForecast { at: string; congestionLevel: string; min: number | null; max: number | null }`
  - `interface Population { place: string; code: string; congestionLevel: string; congestionMessage: string; populationMin: number | null; populationMax: number | null; malePct: number | null; femalePct: number | null; agePct: Record<string, number | null>; residentPct: number | null; nonResidentPct: number | null; measuredAt: string; forecast: PopulationForecast[] }`
  - `function normalizePopulation(raw: any, includeForecast: boolean): Population`
  - `src/tools/resolve.ts`: `function resolvePlace(query: string, ctx: Ctx): { name: string } | { early: ReturnType<typeof ok> }` — 매칭 실패 시 후보 목록을 정상 응답으로 반환(LLM이 되묻게)
  - `function registerPopulationTools(server: McpServer, ctx: Ctx): void` — `get_population` 등록 (`get_commercial_activity`는 Task 6에서 이 파일에 추가)

- [ ] **Step 1: Write the failing test**

`tests/population.test.ts` (픽스처는 Task 2에서 캡처한 `tests/fixtures/ppltn.json`):
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizePopulation } from '../src/normalize/population.js'

const raw = unwrap('citydata_ppltn', JSON.parse(readFileSync('tests/fixtures/ppltn.json', 'utf8'))).rows[0]

describe('normalizePopulation', () => {
  it('혼잡도/인구 min·max를 숫자로 변환', () => {
    const p = normalizePopulation(raw, false)
    expect(['여유', '보통', '약간 붐빔', '붐빔']).toContain(p.congestionLevel)
    expect(typeof p.populationMin).toBe('number')
    expect(typeof p.populationMax).toBe('number')
  })
  it('성·연령 비율 매핑', () => {
    const p = normalizePopulation(raw, false)
    expect(p.malePct).not.toBeNull()
    expect(Object.keys(p.agePct)).toEqual(['0s', '10s', '20s', '30s', '40s', '50s', '60s', '70s+'])
  })
  it('includeForecast=false면 forecast 빈 배열', () => {
    expect(normalizePopulation(raw, false).forecast).toEqual([])
  })
  it('includeForecast=true면 12시간 예측 배열(FCST_YN=Y일 때)', () => {
    const p = normalizePopulation(raw, true)
    if (raw.FCST_YN === 'Y') {
      expect(p.forecast.length).toBeGreaterThan(0)
      expect(p.forecast[0]).toHaveProperty('at')
      expect(p.forecast[0]).toHaveProperty('congestionLevel')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/population.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/population.ts` — 필드명이 픽스처와 다르면 픽스처를 따른다:
```ts
import { num, toArray } from './util.js'

export interface PopulationForecast { at: string; congestionLevel: string; min: number | null; max: number | null }
export interface Population {
  place: string; code: string
  congestionLevel: string; congestionMessage: string
  populationMin: number | null; populationMax: number | null
  malePct: number | null; femalePct: number | null
  agePct: Record<string, number | null>
  residentPct: number | null; nonResidentPct: number | null
  measuredAt: string
  forecast: PopulationForecast[]
}

export function normalizePopulation(raw: any, includeForecast: boolean): Population {
  const fcst = includeForecast && raw.FCST_YN === 'Y'
    ? toArray(raw.FCST_PPLTN?.FCST_PPLTN ?? raw.FCST_PPLTN).map((f: any) => ({
        at: f.FCST_TIME,
        congestionLevel: f.FCST_CONGEST_LVL,
        min: num(f.FCST_PPLTN_MIN),
        max: num(f.FCST_PPLTN_MAX),
      }))
    : []
  return {
    place: raw.AREA_NM,
    code: raw.AREA_CD,
    congestionLevel: raw.AREA_CONGEST_LVL,
    congestionMessage: raw.AREA_CONGEST_MSG,
    populationMin: num(raw.AREA_PPLTN_MIN),
    populationMax: num(raw.AREA_PPLTN_MAX),
    malePct: num(raw.MALE_PPLTN_RATE),
    femalePct: num(raw.FEMALE_PPLTN_RATE),
    agePct: {
      '0s': num(raw.PPLTN_RATE_0), '10s': num(raw.PPLTN_RATE_10), '20s': num(raw.PPLTN_RATE_20),
      '30s': num(raw.PPLTN_RATE_30), '40s': num(raw.PPLTN_RATE_40), '50s': num(raw.PPLTN_RATE_50),
      '60s': num(raw.PPLTN_RATE_60), '70s+': num(raw.PPLTN_RATE_70),
    },
    residentPct: num(raw.RESNT_PPLTN_RATE),
    nonResidentPct: num(raw.NON_RESNT_PPLTN_RATE),
    measuredAt: raw.PPLTN_TIME,
    forecast: fcst,
  }
}
```

`src/tools/resolve.ts`:
```ts
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { searchPlace } from '../data/placeMatcher.js'

/** place 질의를 핫스팟명으로 확정하거나, 후보 목록 응답을 만들어 돌려준다 */
export function resolvePlace(query: string, ctx: Ctx): { name: string } | { early: ReturnType<typeof ok> } {
  const { match, candidates } = searchPlace(query)
  if (match) return { name: match.name }
  return {
    early: ok(
      { requested: query, match: null, candidates, hint: 'candidates 중 정확한 name으로 다시 호출하세요. 실시간 데이터는 121개 핫스팟만 지원합니다.' },
      { source: 'built-in hotspots.ts', sample: ctx.client.isSample },
    ),
  }
}
```

`src/tools/population.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { normalizePopulation } from '../normalize/population.js'

const DELAY_NOTE = '실시간 인구는 통신사 집계·보정으로 약 15분 지연됩니다.'

export function registerPopulationTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_population',
    {
      title: 'Real-time population & congestion',
      description:
        'Get real-time population, congestion level (여유/보통/약간 붐빔/붐빔), demographics, and optional 12-hour AI forecast for a Seoul hotspot. ' +
        '서울 핫스팟의 실시간 인구·혼잡도·성연령 비율·12시간 예측을 조회합니다. "지금 강남역 혼잡해?" 류 질문에 사용.',
      inputSchema: {
        place: z.string().describe('핫스팟 장소명 (search_place로 확정한 name 권장)'),
        includeForecast: z.boolean().optional().describe('향후 12시간 인구 예측 포함 여부 (기본 false)'),
      },
    },
    async ({ place, includeForecast }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getJson('citydata_ppltn', 1, 5, [r.name])
      if (u.rows.length === 0) {
        return ok({ place: r.name, data: null }, { source: 'OA-21778 (citydata_ppltn)', notes: [u.note ?? '데이터 없음'], sample: ctx.client.isSample })
      }
      const data = normalizePopulation(u.rows[0], includeForecast ?? false)
      return ok(data, { source: 'OA-21778 (citydata_ppltn)', asOf: data.measuredAt, notes: [DELAY_NOTE], sample: ctx.client.isSample })
    },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/population.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: population normalizer and get_population tool with 12h forecast"
```

---

### Task 6: 상권 정규화 + `get_commercial_activity`

**Files:**
- Create: `src/normalize/commercial.ts`, `tests/commercial.test.ts`
- Modify: `src/tools/population.ts` (get_commercial_activity 추가)

**Interfaces:**
- Consumes: `resolvePlace`, `ok`, `client.getJson`, `HOTSPOTS`(commercial 플래그), `num`/`toArray`
- Produces:
  - `interface CommercialCategory { large: string; mid: string; level: string; paymentCount: number | null; amountMin: number | null; amountMax: number | null; merchantCount: number | null }`
  - `interface Commercial { level: string; paymentCount: number | null; paymentAmountMin: number | null; paymentAmountMax: number | null; measuredAt: string | null; categories: CommercialCategory[] }`
  - `function normalizeCommercial(raw: any): Commercial`

- [ ] **Step 1: Write the failing test**

`tests/commercial.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeCommercial } from '../src/normalize/commercial.js'

const raw = unwrap('citydata_cmrcl', JSON.parse(readFileSync('tests/fixtures/cmrcl.json', 'utf8'))).rows[0]

describe('normalizeCommercial', () => {
  it('상권 4단계 레벨과 결제 수치', () => {
    const c = normalizeCommercial(raw)
    expect(['한산한', '보통', '바쁜', '분주한']).toContain(c.level)
    expect(typeof c.paymentCount).toBe('number')
  })
  it('업종별 배열 매핑', () => {
    const c = normalizeCommercial(raw)
    expect(c.categories.length).toBeGreaterThan(0)
    expect(c.categories[0]).toHaveProperty('large')
    expect(c.categories[0]).toHaveProperty('level')
    expect(typeof c.categories[0].merchantCount).toBe('number')
  })
})
```

주의: 픽스처의 `AREA_CMRCL_LVL` 값이 "한산한 시간대"처럼 접미사가 붙어 있으면 테스트의 기대값 배열을 픽스처 표기에 맞춘다(픽스처가 정답).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commercial.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/commercial.ts`:
```ts
import { num, toArray } from './util.js'

export interface CommercialCategory {
  large: string; mid: string; level: string
  paymentCount: number | null; amountMin: number | null; amountMax: number | null
  merchantCount: number | null
}
export interface Commercial {
  level: string
  paymentCount: number | null
  paymentAmountMin: number | null; paymentAmountMax: number | null
  measuredAt: string | null
  categories: CommercialCategory[]
}

export function normalizeCommercial(raw: any): Commercial {
  return {
    level: raw.AREA_CMRCL_LVL,
    paymentCount: num(raw.AREA_SH_PAYMENT_CNT),
    paymentAmountMin: num(raw.AREA_SH_PAYMENT_AMT_MIN),
    paymentAmountMax: num(raw.AREA_SH_PAYMENT_AMT_MAX),
    measuredAt: raw.CMRCL_TIME ?? null,
    categories: toArray(raw.CMRCL_RSB).map((r: any) => ({
      large: r.RSB_LRG_CTGR,
      mid: r.RSB_MID_CTGR,
      level: r.RSB_PAYMENT_LVL,
      paymentCount: num(r.RSB_SH_PAYMENT_CNT),
      amountMin: num(r.RSB_SH_PAYMENT_AMT_MIN),
      amountMax: num(r.RSB_SH_PAYMENT_AMT_MAX),
      merchantCount: num(r.RSB_MCT_CNT),
    })),
  }
}
```

`src/tools/population.ts`의 `registerPopulationTools` 안에 추가:
```ts
  server.registerTool(
    'get_commercial_activity',
    {
      title: 'Real-time commercial (card payment) activity',
      description:
        'Get real-time card-payment based commercial activity level (한산한→분주한 4 levels) and per-industry breakdown for a Seoul hotspot (82 supported places). ' +
        '신한카드 실시간 결제 기반 상권 현황. "지금 성수동 장사 잘돼?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명 (상권은 82곳만 지원)') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const spot = HOTSPOTS.find(h => h.name === r.name)!
      if (!spot.commercial) {
        const nearby = HOTSPOTS.filter(h => h.commercial && h.category === spot.category).slice(0, 5).map(h => h.name)
        return ok(
          { place: r.name, supported: false, alternatives: nearby },
          { source: 'OA-22385 (citydata_cmrcl)', notes: ['이 장소는 상권 데이터 미지원(82곳 한정)입니다. alternatives에서 인접 후보를 안내하세요.'], sample: ctx.client.isSample },
        )
      }
      const u = await ctx.client.getJson('citydata_cmrcl', 1, 5, [r.name])
      if (u.rows.length === 0) {
        return ok({ place: r.name, data: null }, { source: 'OA-22385 (citydata_cmrcl)', notes: [u.note ?? '데이터 없음'], sample: ctx.client.isSample })
      }
      const data = normalizeCommercial(u.rows[0])
      return ok({ place: r.name, ...data }, {
        source: 'OA-22385 (citydata_cmrcl)', asOf: data.measuredAt,
        notes: ['신한카드 내국인 결제 기준, 약 15분 지연. 전수 데이터가 아니므로 절대액이 아닌 평소 대비 수준으로 해석하세요.'],
        sample: ctx.client.isSample,
      })
    },
  )
```
파일 상단 import에 `HOTSPOTS`와 `normalizeCommercial` 추가:
```ts
import { HOTSPOTS } from '../data/hotspots.js'
import { normalizeCommercial } from '../normalize/commercial.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commercial.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: commercial normalizer and get_commercial_activity with 82-place guard"
```

---

### Task 7: 지하철 도착 + `get_subway_arrivals`

**Files:**
- Create: `src/normalize/subway.ts`, `src/tools/traffic.ts`, `tests/subway.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `ok`, `client.getSubway`, `num`
- Produces:
  - `interface SubwayArrival { line: string; direction: string; destination: string; trainLine: string; secondsToArrival: number | null; arrivalMessage: string; currentLocation: string; receivedAt: string }`
  - `function normalizeArrivals(rows: any[]): SubwayArrival[]`
  - `function registerTrafficTools(server: McpServer, ctx: Ctx): void` — `get_subway_arrivals` 등록 (bike/parking/road는 Task 8~10에서 이 파일에 추가)

- [ ] **Step 1: Write the failing test**

`tests/subway.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeArrivals, LINE_NAMES } from '../src/normalize/subway.js'

const rows = unwrap('realtimeStationArrival', JSON.parse(readFileSync('tests/fixtures/subway.json', 'utf8'))).rows

describe('normalizeArrivals', () => {
  it('subwayId를 호선명으로 변환', () => {
    const a = normalizeArrivals(rows)
    expect(a.length).toBeGreaterThan(0)
    expect(a[0].line).toMatch(/호선|선|GTX/)
  })
  it('도착까지 초를 숫자로', () => {
    const a = normalizeArrivals(rows)
    expect(a.every(x => x.secondsToArrival === null || typeof x.secondsToArrival === 'number')).toBe(true)
  })
  it('알 수 없는 subwayId는 원본 코드 유지', () => {
    expect(normalizeArrivals([{ subwayId: '9999', barvlDt: '0' }])[0].line).toBe('9999')
  })
  it('LINE_NAMES에 1~9호선 존재', () => {
    expect(LINE_NAMES['1002']).toBe('2호선')
    expect(LINE_NAMES['1009']).toBe('9호선')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/subway.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/subway.ts`:
```ts
import { num } from './util.js'

export const LINE_NAMES: Record<string, string> = {
  '1001': '1호선', '1002': '2호선', '1003': '3호선', '1004': '4호선', '1005': '5호선',
  '1006': '6호선', '1007': '7호선', '1008': '8호선', '1009': '9호선',
  '1032': 'GTX-A', '1061': '중앙선', '1063': '경의중앙선', '1065': '공항철도',
  '1067': '경춘선', '1075': '수인분당선', '1077': '신분당선', '1081': '경강선',
  '1092': '우이신설선', '1093': '서해선',
}

export interface SubwayArrival {
  line: string; direction: string; destination: string; trainLine: string
  secondsToArrival: number | null; arrivalMessage: string; currentLocation: string; receivedAt: string
}

export function normalizeArrivals(rows: any[]): SubwayArrival[] {
  return rows.map(r => ({
    line: LINE_NAMES[r.subwayId] ?? String(r.subwayId),
    direction: r.updnLine ?? '',
    destination: r.bstatnNm ?? '',
    trainLine: r.trainLineNm ?? '',
    secondsToArrival: num(r.barvlDt),
    arrivalMessage: r.arvlMsg2 ?? '',
    currentLocation: r.arvlMsg3 ?? '',
    receivedAt: r.recptnDt ?? '',
  }))
}
```

`src/tools/traffic.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeArrivals } from '../normalize/subway.js'

export function registerTrafficTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_subway_arrivals',
    {
      title: 'Real-time subway arrivals',
      description:
        'Get real-time subway train arrivals for a Seoul station. Pass the station name WITHOUT the "역" suffix if possible (e.g. "강남"). ' +
        '지하철역 실시간 도착 정보. "2호선 강남역 열차 언제 와?" 류 질문에 사용.',
      inputSchema: {
        station: z.string().describe('지하철역명 (예: "강남", "서울역"은 "서울")'),
        limit: z.number().int().min(1).max(30).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ station, limit }) => {
      const name = station.replace(/역$/, '') || station
      const u = await ctx.client.getSubway('realtimeStationArrival', 0, limit ?? 10, [name])
      const data = normalizeArrivals(u.rows)
      return ok(
        { station: name, arrivals: data },
        {
          source: '서울시 지하철 실시간 도착정보 (swopenapi)',
          notes: data.length === 0 ? [u.note ?? '도착 정보 없음 — 역명을 확인하세요 (예: "강남", "홍대입구")'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/subway.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: subway arrivals normalizer and get_subway_arrivals tool"
```

---

### Task 8: 따릉이 + `get_bike_stations`

**Files:**
- Create: `src/normalize/bike.ts`, `tests/bike.test.ts`
- Modify: `src/tools/traffic.ts` (get_bike_stations 추가)

**Interfaces:**
- Consumes: `client.fetchAll('bikeList', …)`, `ok`, `num`
- Produces:
  - `interface BikeStation { id: string; name: string; available: number | null; racks: number | null; ratePct: number | null; lat: number | null; lng: number | null; distanceM?: number }`
  - `function normalizeBikeStations(rows: any[]): BikeStation[]`
  - `function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number`

- [ ] **Step 1: Write the failing test**

`tests/bike.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeBikeStations, haversineM } from '../src/normalize/bike.js'

const rows = unwrap('bikeList', JSON.parse(readFileSync('tests/fixtures/bike.json', 'utf8'))).rows

describe('normalizeBikeStations', () => {
  it('대여소 필드 매핑', () => {
    const s = normalizeBikeStations(rows)[0]
    expect(s.name).toBeTruthy()
    expect(typeof s.available).toBe('number')
    expect(typeof s.lat).toBe('number')
  })
})

describe('haversineM', () => {
  it('서울시청→강남역 약 8.4km(±1km)', () => {
    const d = haversineM(37.5663, 126.9779, 37.4979, 127.0276)
    expect(d).toBeGreaterThan(7_400)
    expect(d).toBeLessThan(9_400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bike.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/bike.ts`:
```ts
import { num } from './util.js'

export interface BikeStation {
  id: string; name: string
  available: number | null; racks: number | null; ratePct: number | null
  lat: number | null; lng: number | null
  distanceM?: number
}

export function normalizeBikeStations(rows: any[]): BikeStation[] {
  return rows.map(r => ({
    id: r.stationId ?? '',
    name: r.stationName ?? '',
    available: num(r.parkingBikeTotCnt),
    racks: num(r.rackTotCnt),
    ratePct: num(r.shared),
    lat: num(r.stationLatitude),
    lng: num(r.stationLongitude),
  }))
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
```

`src/tools/traffic.ts`의 `registerTrafficTools` 안에 추가 (import에 `normalizeBikeStations`, `haversineM` 추가):
```ts
  server.registerTool(
    'get_bike_stations',
    {
      title: 'Ttareungi (Seoul bike) station availability',
      description:
        'Find Seoul public bike (따릉이) stations by name keyword and/or coordinates, with real-time available bike counts. ' +
        '따릉이 대여소 실시간 잔여 대수. 장소 기반은 대여소 이름 키워드 매칭으로 동작 (예: query="강남역").',
      inputSchema: {
        query: z.string().optional().describe('대여소 이름 키워드 (예: "망원", "강남역")'),
        lat: z.number().optional().describe('중심 위도 (radiusM와 함께 사용)'),
        lng: z.number().optional().describe('중심 경도'),
        radiusM: z.number().optional().describe('반경 미터 (기본 500)'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ query, lat, lng, radiusM, limit }) => {
      if (!query && (lat == null || lng == null)) {
        return ok(
          { stations: [], hint: 'query(대여소 이름 키워드) 또는 lat+lng 중 하나는 필요합니다.' },
          { source: 'OA-15493 (bikeList)', sample: ctx.client.isSample },
        )
      }
      const rows = await ctx.client.fetchAll('bikeList', { max: 3000, pageSize: 1000 })
      let stations = normalizeBikeStations(rows)
      if (query) stations = stations.filter(s => s.name.includes(query))
      if (lat != null && lng != null) {
        stations = stations
          .map(s => ({ ...s, distanceM: s.lat != null && s.lng != null ? Math.round(haversineM(lat, lng, s.lat, s.lng)) : Infinity }))
          .filter(s => (s.distanceM ?? Infinity) <= (radiusM ?? 500))
          .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
      }
      return ok(
        { count: stations.length, stations: stations.slice(0, limit ?? 10) },
        { source: 'OA-15493 (bikeList)', notes: stations.length === 0 ? ['조건에 맞는 대여소가 없습니다. 키워드를 줄여보세요.'] : [], sample: ctx.client.isSample },
      )
    },
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bike.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bike station normalizer and get_bike_stations with keyword/geo filter"
```

---

### Task 9: 공영주차장 + `get_parking`

**Files:**
- Create: `src/normalize/parking.ts`, `tests/parking.test.ts`
- Modify: `src/tools/traffic.ts` (get_parking 추가)

**Interfaces:**
- Consumes: `client.fetchAll('GetParkingInfo', …)`, `ok`, `num`
- Produces:
  - `interface ParkingLot { code: string; name: string; address: string; totalSpaces: number | null; occupied: number | null; available: number | null; realtimeYn: string; baseFee: number | null; baseMinutes: number | null; updatedAt: string }`
  - `function normalizeParkingLots(rows: any[]): ParkingLot[]`

- [ ] **Step 1: Write the failing test**

`tests/parking.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeParkingLots } from '../src/normalize/parking.js'

const rows = unwrap('GetParkingInfo', JSON.parse(readFileSync('tests/fixtures/parking.json', 'utf8'))).rows

describe('normalizeParkingLots', () => {
  it('가용면수 = 전체 - 현재 (둘 다 있을 때)', () => {
    const p = normalizeParkingLots(rows).find(x => x.totalSpaces != null && x.occupied != null)
    if (p) expect(p.available).toBe(p.totalSpaces! - p.occupied!)
  })
  it('이름/주소 매핑', () => {
    const p = normalizeParkingLots(rows)[0]
    expect(p.name).toBeTruthy()
    expect(p.address).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parking.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/parking.ts` (필드명은 `tests/fixtures/parking.json` 기준 — PKLT_NM/ADDR/TPKCT/NOW_PRK_VHCL_CNT 등):
```ts
import { num } from './util.js'

export interface ParkingLot {
  code: string; name: string; address: string
  totalSpaces: number | null; occupied: number | null; available: number | null
  realtimeYn: string
  baseFee: number | null; baseMinutes: number | null
  updatedAt: string
}

export function normalizeParkingLots(rows: any[]): ParkingLot[] {
  return rows.map(r => {
    const total = num(r.TPKCT)
    const occupied = num(r.NOW_PRK_VHCL_CNT)
    return {
      code: String(r.PKLT_CD ?? ''),
      name: r.PKLT_NM ?? '',
      address: r.ADDR ?? '',
      totalSpaces: total,
      occupied,
      available: total != null && occupied != null ? total - occupied : null,
      realtimeYn: String(r.PRK_STTS_YN ?? ''),
      baseFee: num(r.BSC_PRK_CRG),
      baseMinutes: num(r.BSC_PRK_HR_UNIT_TM),
      updatedAt: r.NOW_PRK_VHCL_UPDT_TM ?? '',
    }
  })
}
```

`src/tools/traffic.ts`에 추가 (import에 `normalizeParkingLots` 추가):
```ts
  server.registerTool(
    'get_parking',
    {
      title: 'Public parking availability',
      description:
        'Get real-time available spaces in Seoul public parking lots, filtered by place/district keyword matched against lot name and address. ' +
        '공영주차장 실시간 주차 가능 면수 (실시간 연계 122곳 한정). "종로 주차 자리 있어?" 류 질문에 사용.',
      inputSchema: {
        query: z.string().describe('장소/자치구 키워드 (예: "종로", "세종로", "강남")'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ query, limit }) => {
      const rows = await ctx.client.fetchAll('GetParkingInfo', { max: 1000, pageSize: 1000 })
      const lots = normalizeParkingLots(rows).filter(p => p.name.includes(query) || p.address.includes(query))
      return ok(
        { count: lots.length, lots: lots.slice(0, limit ?? 10) },
        {
          source: '서울시 공영주차장 실시간 (GetParkingInfo)',
          notes: [
            '실시간 연계 주차장(약 122곳)만 현재 주차대수를 제공합니다.',
            ...(lots.length === 0 ? ['조건에 맞는 주차장이 없습니다. 자치구명으로 넓혀보세요.'] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parking.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: parking normalizer and get_parking tool"
```

---

### Task 10: citydata 통합(XML) — `get_road_traffic` + `get_weather` + `get_city_snapshot`

**Files:**
- Create: `src/normalize/citydata.ts`, `tests/citydata.test.ts`
- Modify: `src/tools/traffic.ts` (get_road_traffic), `src/tools/environment.ts` 생성(get_weather; get_air_quality는 Task 12), `src/tools/common.ts` (get_city_snapshot)

**Interfaces:**
- Consumes: `client.getXml('citydata', 1, 5, [place])`, `resolvePlace`, `ok`, `num`/`toArray`, `normalizePopulation`
- Produces:
  - `function extractRoadTraffic(citydata: any): { message: string; index: string; averageSpeedKmh: number | null; measuredAt: string; incidents: Array<{ type: string; detail: string; occurredAt: string; message: string }> }`
  - `function extractWeather(citydata: any): { temperatureC: number | null; sensibleTemperatureC: number | null; maxTempC: number | null; minTempC: number | null; humidityPct: number | null; precipitation: string; precipitationType: string; precipitationMessage: string; sunrise: string; sunset: string; uvLevel: string; pm10: number | null; pm10Level: string; pm25: number | null; pm25Level: string; airQualityIndex: string; airMessage: string; warnings: string[]; measuredAt: string }`
  - `function extractSnapshot(citydata: any): { place: string; population: Population; weatherSummary: string; roadMessage: string; events: Array<{ name: string; period: string; place: string }> }`

XML 파싱 특성 주의: citydata XML은 `LIVE_PPLTN_STTS.LIVE_PPLTN_STTS`처럼 같은 이름이 중첩된다. 각 extractor는 `X?.X ?? X` 패턴으로 내부 노드를 꺼낸다. 픽스처 `tests/fixtures/citydata.xml`을 `XMLParser`로 파싱한 실제 구조가 정답.

- [ ] **Step 1: Write the failing test**

`tests/citydata.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { unwrap } from '../src/client/response.js'
import { extractRoadTraffic, extractWeather, extractSnapshot } from '../src/normalize/citydata.js'

const parsed = new XMLParser({ ignoreDeclaration: true }).parse(readFileSync('tests/fixtures/citydata.xml', 'utf8'))
const citydata = unwrap('citydata', parsed).rows[0]

describe('citydata extractors', () => {
  it('도로소통: 평균속도 숫자 + 메시지', () => {
    const r = extractRoadTraffic(citydata)
    expect(typeof r.message).toBe('string')
    expect(r.averageSpeedKmh === null || typeof r.averageSpeedKmh === 'number').toBe(true)
  })
  it('날씨: 기온/미세먼지 숫자화', () => {
    const w = extractWeather(citydata)
    expect(w.temperatureC === null || typeof w.temperatureC === 'number').toBe(true)
    expect(w.pm10 === null || typeof w.pm10 === 'number').toBe(true)
  })
  it('스냅샷: 인구+날씨요약+행사 목록', () => {
    const s = extractSnapshot(citydata)
    expect(s.place).toBe('광화문·덕수궁')
    expect(s.population.congestionLevel).toBeTruthy()
    expect(Array.isArray(s.events)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/citydata.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/citydata.ts`:
```ts
import { num, toArray } from './util.js'
import { normalizePopulation, type Population } from './population.js'

const inner = (node: any, key: string) => node?.[key]?.[key] ?? node?.[key] ?? null

export function extractRoadTraffic(citydata: any) {
  const road = citydata?.ROAD_TRAFFIC_STTS ?? {}
  const avg = road.AVG_ROAD_DATA ?? {}
  const incidents = toArray(inner(citydata, 'ACDNT_CNTRL_STTS')).map((a: any) => ({
    type: a.ACDNT_TYPE ?? '',
    detail: a.ACDNT_DTYPE ?? '',
    occurredAt: a.ACDNT_OCCR_DT ?? '',
    message: a.ACDNT_INFO ?? '',
  }))
  return {
    message: avg.ROAD_MSG ?? '',
    index: avg.ROAD_TRAFFIC_IDX ?? '',
    averageSpeedKmh: num(avg.ROAD_TRAFFIC_SPD),
    measuredAt: avg.ROAD_TRAFFIC_TIME ?? '',
    incidents,
  }
}

export function extractWeather(citydata: any) {
  const w = inner(citydata, 'WEATHER_STTS') ?? {}
  return {
    temperatureC: num(w.TEMP),
    sensibleTemperatureC: num(w.SENSIBLE_TEMP),
    maxTempC: num(w.MAX_TEMP),
    minTempC: num(w.MIN_TEMP),
    humidityPct: num(w.HUMIDITY),
    precipitation: w.PRECIPITATION ?? '',
    precipitationType: w.PRECPT_TYPE ?? '',
    precipitationMessage: w.PCP_MSG ?? '',
    sunrise: String(w.SUNRISE ?? ''),
    sunset: String(w.SUNSET ?? ''),
    uvLevel: w.UV_INDEX_LVL != null ? String(w.UV_INDEX_LVL) : '',
    pm10: num(w.PM10),
    pm10Level: w.PM10_INDEX ?? '',
    pm25: num(w.PM25),
    pm25Level: w.PM25_INDEX ?? '',
    airQualityIndex: w.AIR_IDX ?? '',
    airMessage: w.AIR_MSG ?? '',
    warnings: toArray(w.NEWS_LIST?.WARN_VAL).map(String),
    measuredAt: w.WEATHER_TIME ?? '',
  }
}

export function extractSnapshot(citydata: any): {
  place: string; population: Population; weatherSummary: string; roadMessage: string
  events: Array<{ name: string; period: string; place: string }>
} {
  const ppltn = inner(citydata, 'LIVE_PPLTN_STTS')
  const population = normalizePopulation(ppltn ?? {}, false)
  const w = extractWeather(citydata)
  const events = toArray(inner(citydata, 'EVENT_STTS')).slice(0, 5).map((e: any) => ({
    name: e.EVENT_NM ?? '',
    period: e.EVENT_PERIOD ?? '',
    place: e.EVENT_PLACE ?? '',
  }))
  return {
    place: citydata?.AREA_NM ?? '',
    population,
    weatherSummary: `기온 ${w.temperatureC ?? '?'}°C, ${w.precipitationMessage || '강수 정보 없음'}, PM2.5 ${w.pm25Level || '?'}`,
    roadMessage: extractRoadTraffic(citydata).message,
    events,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/citydata.test.ts`
Expected: 3 tests PASS (필드 구조가 픽스처와 다르면 extractor의 키 경로를 픽스처에 맞게 수정)

- [ ] **Step 5: tool 3개 등록**

`src/tools/traffic.ts`에 추가 (import에 `resolvePlace`, `extractRoadTraffic` 추가):
```ts
  server.registerTool(
    'get_road_traffic',
    {
      title: 'Road traffic & incidents around a hotspot',
      description:
        'Get average road speed, congestion message, and accident/control incidents around a Seoul hotspot. ' +
        '핫스팟 주변 도로소통·사고통제 현황. "광화문 근처 길 막혀?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const data = extractRoadTraffic(u.rows[0] ?? {})
      return ok({ place: r.name, ...data }, { source: 'OA-21285 (citydata ROAD_TRAFFIC_STTS)', asOf: data.measuredAt || null, sample: ctx.client.isSample })
    },
  )
```

`src/tools/environment.ts` 생성:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { extractWeather } from '../normalize/citydata.js'

export function registerEnvironmentTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_weather',
    {
      title: 'Weather & fine dust at a hotspot',
      description:
        'Get current temperature, precipitation, fine dust (PM10/PM2.5), UV, sunrise/sunset and weather warnings for a Seoul hotspot. ' +
        '핫스팟 기준 날씨·미세먼지·기상특보. "지금 여의도 날씨 어때?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const data = extractWeather(u.rows[0] ?? {})
      return ok({ place: r.name, ...data }, { source: 'OA-21285 (citydata WEATHER_STTS, 기상청 연계)', asOf: data.measuredAt || null, sample: ctx.client.isSample })
    },
  )
}
```

`src/tools/common.ts`의 `registerCommonTools` 안에 추가 (import에 `resolvePlace`, `extractSnapshot` 추가):
```ts
  server.registerTool(
    'get_city_snapshot',
    {
      title: 'One-shot city snapshot of a hotspot',
      description:
        'Get a combined snapshot (population/congestion + weather + road + top events) of a Seoul hotspot in ONE call. Prefer this for broad "how is X right now?" questions. ' +
        '핫스팟 종합 현황 1회 요약. "지금 홍대 어때?" 같은 포괄 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const data = extractSnapshot(u.rows[0] ?? {})
      return ok(data, { source: 'OA-21285 (citydata)', asOf: data.population.measuredAt || null, notes: ['인구는 약 15분 지연. 세부 분야는 개별 tool로 조회하세요.'], sample: ctx.client.isSample })
    },
  )
```

- [ ] **Step 6: 전체 테스트 + 커밋**

Run: `npm test && npm run build`
Expected: 전부 PASS

```bash
git add -A && git commit -m "feat: citydata XML extractors + road/weather/snapshot tools"
```

---

### Task 11: 문화행사 + `search_cultural_events`

**Files:**
- Create: `src/normalize/culture.ts`, `src/tools/culture.ts`, `tests/culture.test.ts`

**Interfaces:**
- Consumes: `client.getJson('culturalEventInfo', …)`, `ok`
- Produces:
  - `interface CulturalEvent { category: string; district: string; title: string; period: string; startDate: string; endDate: string; place: string; fee: string; isFree: boolean; link: string }`
  - `function normalizeEvents(rows: any[]): CulturalEvent[]`
  - `function filterEvents(events: CulturalEvent[], f: { district?: string; from?: string; to?: string; freeOnly?: boolean }): CulturalEvent[]`
  - `function registerCultureTools(server: McpServer, ctx: Ctx): void`

- [ ] **Step 1: Write the failing test**

`tests/culture.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeEvents, filterEvents } from '../src/normalize/culture.js'

const rows = unwrap('culturalEventInfo', JSON.parse(readFileSync('tests/fixtures/culture.json', 'utf8'))).rows

describe('normalizeEvents', () => {
  it('행사 필드 매핑 + 날짜 YYYY-MM-DD 절단', () => {
    const e = normalizeEvents(rows)[0]
    expect(e.title).toBeTruthy()
    expect(e.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('isFree: 무료 표기 감지', () => {
    const free = normalizeEvents([{ USE_FEE: '무료', STRTDATE: '2026-01-01 00:00:00.0', END_DATE: '2026-01-02 00:00:00.0' }])[0]
    expect(free.isFree).toBe(true)
  })
})

describe('filterEvents', () => {
  const evts = normalizeEvents([
    { GUNAME: '강동구', TITLE: 'A', STRTDATE: '2026-12-24 00:00:00.0', END_DATE: '2026-12-24 00:00:00.0', USE_FEE: '10000원' },
    { GUNAME: '마포구', TITLE: 'B', STRTDATE: '2026-08-01 00:00:00.0', END_DATE: '2026-08-31 00:00:00.0', USE_FEE: '' },
  ])
  it('자치구 필터', () => expect(filterEvents(evts, { district: '마포구' })).toHaveLength(1))
  it('기간 겹침 필터: 8월 중순 조회 시 B만', () =>
    expect(filterEvents(evts, { from: '2026-08-10', to: '2026-08-20' }).map(e => e.title)).toEqual(['B']))
  it('freeOnly: 요금 빈 문자열/무료만', () =>
    expect(filterEvents(evts, { freeOnly: true }).map(e => e.title)).toEqual(['B']))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/culture.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/culture.ts`:
```ts
export interface CulturalEvent {
  category: string; district: string; title: string; period: string
  startDate: string; endDate: string; place: string; fee: string; isFree: boolean; link: string
}

const day = (v: any): string => String(v ?? '').slice(0, 10)

export function normalizeEvents(rows: any[]): CulturalEvent[] {
  return rows.map(r => {
    const fee = String(r.USE_FEE ?? '').trim()
    return {
      category: r.CODENAME ?? '',
      district: r.GUNAME ?? '',
      title: r.TITLE ?? '',
      period: r.DATE ?? '',
      startDate: day(r.STRTDATE),
      endDate: day(r.END_DATE),
      place: r.PLACE ?? '',
      fee,
      isFree: fee === '' || fee.includes('무료'),
      link: r.ORG_LINK ?? r.HMPG_ADDR ?? '',
    }
  })
}

export function filterEvents(
  events: CulturalEvent[],
  f: { district?: string; from?: string; to?: string; freeOnly?: boolean },
): CulturalEvent[] {
  return events.filter(e => {
    if (f.district && !e.district.includes(f.district)) return false
    if (f.freeOnly && !e.isFree) return false
    if (f.from && e.endDate && e.endDate < f.from) return false
    if (f.to && e.startDate && e.startDate > f.to) return false
    return true
  })
}
```

`src/tools/culture.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeEvents, filterEvents } from '../normalize/culture.js'

export function registerCultureTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_cultural_events',
    {
      title: 'Search Seoul cultural events',
      description:
        'Search Seoul cultural events (concerts, exhibitions, festivals) by keyword/category/district/date-range/free-only. ' +
        '서울시 문화행사 검색. "이번 주말 마포구 무료 공연 있어?" 류 질문에 사용.',
      inputSchema: {
        keyword: z.string().optional().describe('행사명 키워드 (API TITLE 검색)'),
        category: z.string().optional().describe('분류 (예: 콘서트, 전시/미술, 축제-문화/예술)'),
        district: z.string().optional().describe('자치구 (예: 마포구)'),
        from: z.string().optional().describe('기간 시작 YYYY-MM-DD'),
        to: z.string().optional().describe('기간 끝 YYYY-MM-DD'),
        freeOnly: z.boolean().optional().describe('무료만'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 15)'),
      },
    },
    async ({ keyword, category, district, from, to, freeOnly, limit }) => {
      // 경로 파라미터: /{CODENAME}/{TITLE}/{DATE} — 생략은 공백 한 칸
      const path = [category ?? ' ', keyword ?? ' ', ' ']
      const u = await ctx.client.getJson('culturalEventInfo', 1, 500, path)
      const events = filterEvents(normalizeEvents(u.rows), { district, from, to, freeOnly })
      return ok(
        { count: events.length, events: events.slice(0, limit ?? 15) },
        {
          source: 'OA-15486 (culturalEventInfo)',
          notes: [
            '서버에서 category/keyword로 1차 검색 후 최대 500건 내에서 자치구·기간·무료 필터를 적용했습니다.',
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/culture.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: cultural events normalizer, filters and search_cultural_events"
```

---

### Task 12: 대기질 + `get_air_quality`

**Files:**
- Create: `src/normalize/air.ts`, `tests/air.test.ts`
- Modify: `src/tools/environment.ts` (get_air_quality 추가)

**Interfaces:**
- Consumes: `client.getJson('RealtimeCityAir', …)`, `ok`, `num`
- Produces:
  - `interface AirQuality { region: string; district: string; pm10: number | null; pm25: number | null; ozone: number | null; no2: number | null; co: number | null; so2: number | null; grade: string; index: number | null; mainPollutant: string; measuredAt: string }`
  - `function normalizeAir(rows: any[]): AirQuality[]`

- [ ] **Step 1: Write the failing test**

`tests/air.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeAir } from '../src/normalize/air.js'

const rows = unwrap('RealtimeCityAir', JSON.parse(readFileSync('tests/fixtures/air.json', 'utf8'))).rows

describe('normalizeAir', () => {
  it('자치구/권역/등급 매핑', () => {
    const a = normalizeAir(rows)[0]
    expect(a.district).toBeTruthy()
    expect(a.region).toBeTruthy()
    expect(['좋음', '보통', '나쁨', '매우나쁨', '']).toContain(a.grade)
  })
  it('PM 수치 숫자화', () => {
    const a = normalizeAir(rows)[0]
    expect(a.pm10 === null || typeof a.pm10 === 'number').toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/air.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/normalize/air.ts` (픽스처 필드: MSRMT_DT/SAREA_NM/MSRSTN_NM/PM/FPM/OZON/NTDX/CBMX/SPDX/CAI_GRD/CAI_IDX/CRST_SBSTN):
```ts
import { num } from './util.js'

export interface AirQuality {
  region: string; district: string
  pm10: number | null; pm25: number | null
  ozone: number | null; no2: number | null; co: number | null; so2: number | null
  grade: string; index: number | null; mainPollutant: string
  measuredAt: string
}

export function normalizeAir(rows: any[]): AirQuality[] {
  return rows.map(r => ({
    region: r.SAREA_NM ?? '',
    district: r.MSRSTN_NM ?? '',
    pm10: num(r.PM),
    pm25: num(r.FPM),
    ozone: num(r.OZON),
    no2: num(r.NTDX),
    co: num(r.CBMX),
    so2: num(r.SPDX),
    grade: r.CAI_GRD ?? '',
    index: num(r.CAI_IDX),
    mainPollutant: r.CRST_SBSTN ?? '',
    measuredAt: String(r.MSRMT_DT ?? ''),
  }))
}
```

`src/tools/environment.ts`의 `registerEnvironmentTools` 안에 추가 (import에 `normalizeAir` 추가):
```ts
  server.registerTool(
    'get_air_quality',
    {
      title: 'Real-time air quality by district',
      description:
        'Get real-time air quality (PM10/PM2.5, grade) for Seoul districts. Omit district to get all 25. ' +
        '자치구별 실시간 대기질. "오늘 강남구 미세먼지 어때?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().optional().describe('자치구명 (예: "강남구") — 생략 시 25개 전체'),
      },
    },
    async ({ district }) => {
      const u = await ctx.client.getJson('RealtimeCityAir', 1, 25)
      let rows = normalizeAir(u.rows)
      if (district) rows = rows.filter(a => a.district.includes(district.replace(/구$/, '')) || a.district === district)
      return ok(
        { count: rows.length, airQuality: rows },
        {
          source: '서울시 권역별 실시간 대기환경 (RealtimeCityAir)',
          asOf: rows[0]?.measuredAt ?? null,
          notes: rows.length === 0 ? ['해당 자치구를 찾지 못했습니다. "강남구"처럼 정식 자치구명을 쓰세요.'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/air.test.ts && npm run build`
Expected: PASS + 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: air quality normalizer and get_air_quality tool"
```

---

### Task 13: 서버 조립 + stdio 엔트리 + tools/list 스모크

**Files:**
- Modify: `src/index.ts` (임시 스캐폴드 교체), `tests/smoke.test.ts` (서버 구성 검증으로 교체)

**Interfaces:**
- Consumes: `registerCommonTools`, `registerPopulationTools`, `registerTrafficTools`, `registerCultureTools`, `registerEnvironmentTools`, `SeoulApiClient`
- Produces: `function buildServer(client?: SeoulApiClient): McpServer` (테스트용 export), CLI 엔트리(stdio)

- [ ] **Step 1: Write the failing test**

`tests/smoke.test.ts` 교체:
```ts
import { describe, it, expect } from 'vitest'
import { buildServer, SERVER_NAME, TOOL_NAMES } from '../src/index.js'

describe('server assembly', () => {
  it('11개 tool이 전부 등록된다', () => {
    expect(TOOL_NAMES).toEqual([
      'search_place', 'get_city_snapshot',
      'get_population', 'get_commercial_activity',
      'get_subway_arrivals', 'get_bike_stations', 'get_parking', 'get_road_traffic',
      'search_cultural_events',
      'get_air_quality', 'get_weather',
    ])
    expect(buildServer()).toBeTruthy()
    expect(SERVER_NAME).toBe('seoul-opendata-mcp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/smoke.test.ts`
Expected: FAIL — `buildServer` 없음

- [ ] **Step 3: 구현**

`src/index.ts` 전체 교체:
```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SeoulApiClient } from './client/seoulApi.js'
import type { Ctx } from './tools/context.js'
import { registerCommonTools } from './tools/common.js'
import { registerPopulationTools } from './tools/population.js'
import { registerTrafficTools } from './tools/traffic.js'
import { registerCultureTools } from './tools/culture.js'
import { registerEnvironmentTools } from './tools/environment.js'

export const SERVER_NAME = 'seoul-opendata-mcp'
export const SERVER_VERSION = '0.1.0'

export const TOOL_NAMES = [
  'search_place', 'get_city_snapshot',
  'get_population', 'get_commercial_activity',
  'get_subway_arrivals', 'get_bike_stations', 'get_parking', 'get_road_traffic',
  'search_cultural_events',
  'get_air_quality', 'get_weather',
] as const

export function buildServer(client: SeoulApiClient = new SeoulApiClient()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const ctx: Ctx = { client }
  registerCommonTools(server, ctx)
  registerPopulationTools(server, ctx)
  registerTrafficTools(server, ctx)
  registerCultureTools(server, ctx)
  registerEnvironmentTools(server, ctx)
  return server
}

// CLI 실행 시에만 stdio 연결 (테스트 import 시에는 연결 안 함)
const isCli = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')
if (isCli) {
  const client = new SeoulApiClient()
  if (client.isSample) {
    console.error(`[${SERVER_NAME}] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다 (제한: citydata 계열은 광화문·덕수궁만).`)
  }
  await buildServer(client).connect(new StdioServerTransport())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npm run build`
Expected: 전부 PASS, 빌드 성공

- [ ] **Step 5: 실제 왕복 스모크 (JSON-RPC로 tools/list)**

Run:
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | node dist/index.js | tail -1 | grep -o '"name":"[a-z_]*"' | sort
```
Expected: 11개 tool 이름 전부 출력. 추가로 `npm run inspect`로 MCP Inspector에서 `search_place("강남")` → `get_population("강남역")` 왕복을 눈으로 확인 (샘플 키면 광화문·덕수궁으로 확인).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: assemble MCP server with 11 tools over stdio"
```

---

### Task 14: README(한/영) + LICENSE + npm 패키징

**Files:**
- Create: `README.md`(영문), `README.ko.md`(한글), `LICENSE`(MIT)
- Modify: `package.json` (repository/bugs/homepage 필드 추가)

**Interfaces:**
- Consumes: 완성된 tool 11개 (문서화 대상)
- Produces: npm publish 가능한 패키지 메타 + 사용자 온보딩 문서

- [ ] **Step 1: LICENSE 작성**

MIT 전문에 `Copyright (c) 2026 <GitHub 계정명>` — 계정명은 커밋 전에 사용자에게 확인.

- [ ] **Step 2: README.md / README.ko.md 작성**

두 파일 공통 구성(영문판 먼저 작성, 한글판은 동일 구조 번역). 반드시 포함:

1. 한 줄 소개 + 데모 프롬프트: `"지금 강남역 혼잡도 어때?" / "Is Gangnam crowded right now?"`
2. **Quick Start — Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "seoul-opendata": {
      "command": "npx",
      "args": ["-y", "seoul-opendata-mcp"],
      "env": { "SEOUL_API_KEY": "YOUR_KEY" }
    }
  }
}
```
3. **Claude Code**: `claude mcp add seoul-opendata -e SEOUL_API_KEY=YOUR_KEY -- npx -y seoul-opendata-mcp`
4. **API 키 발급 (5분)**: data.seoul.go.kr 로그인 → 인증키 신청 → 즉시 발급. 키 없이도 샘플 모드로 동작(광화문·덕수궁 한정)임을 명시
5. **Tools 표**: 11개 tool 이름/설명/주요 인자 (Task 13의 TOOL_NAMES 순서)
6. **커버리지와 한계**: 121개 핫스팟 한정, 상권 82곳, 인구 15분 지연, 무료 쿼터 일 1,000회
7. **데이터 출처 고지**: 서울 열린데이터광장, KT/SKT·신한카드·Tmoney 융합 데이터 기반 '서울 실시간 도시데이터'
8. **예시 프롬프트 6개**: 혼잡도/12시간 예측/상권/따릉이/무료 행사/미세먼지 각 1개

- [ ] **Step 3: package.json 메타 추가**

`repository.url = "git+https://github.com/<계정명>/Seoul-OpenData-MCP.git"`, `bugs`, `homepage` 필드 추가 (계정명은 사용자 확인 후).

- [ ] **Step 4: 검증**

Run: `npm pack --dry-run`
Expected: `dist/`, `README.md`, `README.ko.md`, `LICENSE`, `package.json`만 포함되고 `tests/`, `src/`, `scripts/`는 제외

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: bilingual README, MIT license, npm packaging metadata"
```

---

### Task 15: MCPB 번들

**Files:**
- Create: `manifest.json`
- Modify: `.gitignore` (이미 `*.mcpb` 포함 확인), `package.json` scripts에 `"bundle": "npx @anthropic-ai/mcpb pack"` 추가

**Interfaces:**
- Consumes: 빌드 산출물 `dist/index.js`
- Produces: Claude Desktop 더블클릭 설치용 `.mcpb` 파일 (키 입력 UI 포함)

- [ ] **Step 1: manifest.json 작성**

```json
{
  "manifest_version": "0.2",
  "name": "seoul-opendata-mcp",
  "display_name": "Seoul Open Data",
  "version": "0.1.0",
  "description": "Real-time Seoul city data: congestion, population forecast, commercial activity, transit, weather, events. 서울 실시간 도시데이터 MCP 서버.",
  "author": { "name": "<GitHub 계정명>" },
  "license": "MIT",
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": { "SEOUL_API_KEY": "${user_config.seoul_api_key}" }
    }
  },
  "user_config": {
    "seoul_api_key": {
      "type": "string",
      "title": "Seoul Open Data API Key",
      "description": "data.seoul.go.kr에서 무료 발급. 비우면 샘플 모드(광화문·덕수궁 한정)로 동작합니다.",
      "sensitive": true,
      "required": false
    }
  }
}
```
`npx @anthropic-ai/mcpb pack` 실행 시 스키마 오류가 나오면 그 메시지에 맞춰 필드를 조정한다(mcpb CLI가 최신 스키마의 정본).

- [ ] **Step 2: 번들 생성 검증**

Run: `npm run build && npm run bundle && ls -la *.mcpb`
Expected: `seoul-opendata-mcp.mcpb` 생성. (가능하면 Claude Desktop에 드래그해 설치 → 키 입력 UI 확인)

- [ ] **Step 3: Commit**

```bash
git add manifest.json package.json && git commit -m "feat: MCPB bundle manifest for one-click Claude Desktop install"
```

---

## 라이브 검증 (선택, 키 보유 시)

`RUN_LIVE=1 SEOUL_API_KEY=<키>`로 실 API 스모크: `get_population("강남역")`이 121곳 전체에서 동작하는지, `get_commercial_activity("성수카페거리")`가 상권 데이터를 반환하는지 확인. 샘플 키만 있으면 광화문·덕수궁으로 대체.

## Self-Review 결과 (플랜 작성자 체크)

- 스펙 §2 표의 8개 서비스 전부 태스크에 매핑됨 (citydata→10, ppltn→5, cmrcl→6, bikeList→8, culturalEventInfo→11, GetParkingInfo→9, RealtimeCityAir→12, realtimeStationArrival→7)
- 스펙 §4 tool 11개 전부 매핑됨 (search_place→4, snapshot→10, population→5, commercial→6, subway→7, bike→8, parking→9, road→10, events→11, air→12, weather→10)
- 스펙 §5 배포 → Task 14·15, §6 테스트 → 각 태스크 TDD + 픽스처(Task 2) + 라이브 게이트
- 스펙과의 의도적 차이 2건: ① `envelope.ts`는 Task 5가 아닌 Task 4에서 생성(첫 tool이 필요로 함) ② `get_bike_stations`의 장소 기반 검색은 좌표 데이터 부재로 "대여소 이름 키워드 매칭 + 선택적 좌표 반경"으로 구현 (스펙 §4 의도 충족, 가짜 좌표 내장 회피)

