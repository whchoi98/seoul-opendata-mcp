# Seoul-OpenData-MCP v2 하이브리드 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1(tool 11개) 위에 .env 키 2종 관리, 카탈로그 28개 + 메타 tool 3개, 승격 tool 5개를 추가해 tool 19개 / 데이터셋 28개 커버리지의 v0.2.0을 만든다.

**Architecture:** 기존 3층(client→normalize→tools)을 그대로 재사용. 신규 HTTP 코드 없이 클라이언트에 subwayKey 분리와 .env 로더만 추가하고, `data/catalog.ts` 인덱스를 메타 tool 3개(search/spec/call)가 소비한다. 승격 tool 5개는 v1과 동일한 정규화·픽스처 규율을 따른다.

**Tech Stack:** v1과 동일 (TypeScript strict/ESM, @modelcontextprotocol/sdk, zod, fast-xml-parser, vitest). 신규 런타임 의존성 0개 (.env 로더 자체 구현).

**Spec:** `docs/superpowers/specs/2026-08-16-seoul-opendata-mcp-v2-design.md` (v1 스펙 `2026-08-14-…`도 함께 바인딩)

## Global Constraints

- v1 전 규칙 승계: 모든 tool 응답은 `ok()` 봉투 `{data, asOf, source, notes}` / 외부 HTTP는 SeoulApiClient 경유만 / 단위 테스트 네트워크 금지(픽스처) / **tests/fixtures/* 불변(코드가 픽스처에 맞춤)** / 매핑 동등성 테스트(실제 `num()` import, 픽스처 행 순회) / tool 설명 영어 ≤2문장 + 한국어 병기 / TDD RED→GREEN / 커밋 `feat:` `fix:` `test:` `docs:` `chore:`
- 키 우선순위: 명시적 env > `.env` 파일 > `sample`. 지하철: `SEOUL_SUBWAY_API_KEY` → `SEOUL_API_KEY` → `sample`. 빈 문자열/공백은 미설정 취급(trim)
- `.env`는 절대 커밋 금지(.gitignore·.mcpbignore 기등재). 키 값은 로그·에러·테스트 코드에 노출 금지 — 테스트는 가짜 키 문자열만 사용
- `call_dataset`은 카탈로그 등재 + `callable: true` id만 허용. limit 기본 10, 최대 50
- 카탈로그 카테고리는 정확히 6종: `교통·이동` `생활·인구` `부동산·경제` `문화·여가` `보건·복지` `안전·환경`
- 픽스처 캡처 시 검증된 파라미터 고정 사용: 승하차 `20260801`, 시간평균 대기질 `202608151100` (캡처 스크립트만 네트워크 허용, 호출 간 1.2초 간격 — ERROR-337 회피)
- 버전: package.json / SERVER_VERSION / manifest.json 모두 `0.2.0`으로 동기화 (Task 6에서 일괄)

## File Structure

```
src/client/env.ts            # loadDotEnv() (Task 1)
src/client/seoulApi.ts       # subwayKey 분리 (Task 1 수정)
src/data/catalog.ts          # DatasetEntry 28개 + searchCatalog/validateCall (Task 2)
src/tools/meta.ts            # search_dataset/get_dataset_spec/call_dataset (Task 3)
src/normalize/stats.ts       # 승하차/생활인구/실거래가 정규화 (Task 4)
src/tools/stats.ts           # registerStatsTools — 승격 3종 (Task 4)
src/normalize/health.ts      # 약국 정규화 (Task 5)
src/tools/health.ts          # registerHealthTools — find_pharmacies (Task 5)
src/normalize/citydata.ts    # extractDisasterAlerts 추가 (Task 5 수정)
src/tools/common.ts          # get_disaster_alerts 추가 (Task 5 수정)
src/index.ts                 # TOOL_NAMES 19 + loadDotEnv + register 3개 추가 (Task 6 수정)
.env.example                 # 키 2종 템플릿 (Task 1)
scripts/capture-fixtures.ts  # 신규 6종 캡처 추가 (Task 2 수정)
scripts/live-sweep.ts        # 19개 tool 전수 라이브 스위프 (Task 7)
tests/env.test.ts, catalog.test.ts, meta.test.ts, stats.test.ts, health.test.ts (신규)
tests/live.test.ts           # 승하차 + call_dataset 케이스 추가 (Task 7 수정)
tests/smoke.test.ts          # TOOL_NAMES 19로 갱신 (Task 6 수정)
```

스펙 대비 구조 보강 1건(문서화된 편차): `DatasetEntry`에 `endpoint: 'open' | 'subway'` 필드 추가 — 지하철 실시간(realtimeStationArrival)을 call_dataset이 올바른 베이스·키로 라우팅하기 위해 필요. 스펙 §3 스키마의 자연 확장이며 SDD 원장에 기록할 것.

---

### Task 1: .env 로더 + 지하철 키 분리

**Files:**
- Create: `src/client/env.ts`, `.env.example`, `tests/env.test.ts`
- Modify: `src/client/seoulApi.ts` (subwayKey), `src/index.ts` (CLI 블록에서 loadDotEnv 호출)
- Test: `tests/env.test.ts`, `tests/seoulApi.test.ts`(케이스 추가)

**Interfaces:**
- Produces:
  - `function loadDotEnv(path?: string): void` — 존재하면 파싱, **기설정 env는 덮어쓰지 않음**
  - `ClientOptions`에 `subwayApiKey?: string` 추가
  - `SeoulApiClient`: `getSubway()`가 subwayKey 사용 (폴백: 전용 → 일반 → 'sample'), 요청별 사용 키가 'sample'일 때만 5건 클램프

- [ ] **Step 1: Write the failing tests**

`tests/env.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDotEnv } from '../src/client/env.js'

const CLEAN = ['T_ALPHA', 'T_BETA', 'T_QUOTED', 'T_EXISTING']
let dir: string

afterEach(() => {
  for (const k of CLEAN) delete process.env[k]
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('loadDotEnv', () => {
  it('KEY=VALUE 파싱 + 주석/빈 줄 무시 + 따옴표 제거', () => {
    dir = mkdtempSync(join(tmpdir(), 'env-'))
    writeFileSync(join(dir, '.env'), '# comment\nT_ALPHA=one\n\nT_QUOTED="two two"\n')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.T_ALPHA).toBe('one')
    expect(process.env.T_QUOTED).toBe('two two')
  })
  it('이미 설정된 환경변수는 덮어쓰지 않는다', () => {
    dir = mkdtempSync(join(tmpdir(), 'env-'))
    process.env.T_EXISTING = 'keep'
    writeFileSync(join(dir, '.env'), 'T_EXISTING=overwrite\nT_BETA=new\n')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.T_EXISTING).toBe('keep')
    expect(process.env.T_BETA).toBe('new')
  })
  it('파일이 없으면 조용히 무시', () => {
    expect(() => loadDotEnv('/nonexistent/.env')).not.toThrow()
  })
})
```

`tests/seoulApi.test.ts`에 추가 (기존 describe 안):
```ts
  it('지하철 키 폴백 체인: 전용 → 일반 → sample', () => {
    delete process.env.SEOUL_API_KEY
    delete process.env.SEOUL_SUBWAY_API_KEY
    const dedicated = new SeoulApiClient({ apiKey: 'GEN', subwayApiKey: 'SUB', fetchFn: vi.fn() as any })
    expect(dedicated.maskedSubwayKey()).toBe('SUB…(masked)')
    const inherited = new SeoulApiClient({ apiKey: 'GEN', fetchFn: vi.fn() as any })
    expect(inherited.maskedSubwayKey()).toBe('GEN…(masked)')
    const sample = new SeoulApiClient({ fetchFn: vi.fn() as any })
    expect(sample.maskedSubwayKey()).toBe('sample')
  })

  it('getSubway는 subwayKey로 URL을 만든다', async () => {
    const payload = { errorMessage: { status: 200, code: 'INFO-000', message: 'ok', total: 0 }, realtimeArrivalList: [] }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload))
    const c = new SeoulApiClient({ apiKey: 'GEN', subwayApiKey: 'SUBKEY', fetchFn: fetchFn as any })
    await c.getSubway('realtimeStationArrival', 0, 5, ['강남'])
    expect(fetchFn.mock.calls[0][0]).toContain('/SUBKEY/json/')
    expect(fetchFn.mock.calls[0][0]).not.toContain('/GEN/')
  })
```
참고: `maskedSubwayKey`는 4자 미만 키('sample' 제외)도 안전해야 하므로 `slice(0, 4)` 사용(기존 maskedKey와 동일 규칙, 'sample'은 그대로 노출 — v1과 동일).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/env.test.ts tests/seoulApi.test.ts`
Expected: FAIL — env.js 모듈 없음, maskedSubwayKey 없음

- [ ] **Step 3: 구현**

`src/client/env.ts`:
```ts
import { readFileSync, existsSync } from 'node:fs'

/** CWD(또는 지정 경로)의 .env를 읽어, 아직 설정되지 않은 환경변수만 채운다. 명시적 env > .env */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val
  }
}
```

`src/client/seoulApi.ts` 수정:
```ts
// ClientOptions에 추가
export interface ClientOptions {
  apiKey?: string
  subwayApiKey?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

// 생성자에서 (기존 this.key 줄 다음에)
this.subwayKey = (opts.subwayApiKey ?? process.env.SEOUL_SUBWAY_API_KEY ?? '').trim() || this.key

// 필드 선언 추가
private subwayKey: string

// 마스킹 추가 (maskedKey 아래)
maskedSubwayKey(): string {
  return this.subwayKey === 'sample' ? 'sample' : `${this.subwayKey.slice(0, 4)}…(masked)`
}

// buildUrl이 키를 인자로 받도록 변경
private buildUrl(base: string, key: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): string {
  const segs = [key, type, service, String(start), String(end), ...path.map(encodeURIComponent)]
  return `${base}/${segs.join('/')}`
}

// fetchUnwrapped: 베이스별 키 선택 + 사용 키 기준 클램프
private async fetchUnwrapped(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): Promise<Unwrapped> {
  const key = base === SUBWAY_BASE ? this.subwayKey : this.key
  // 샘플 키는 요청당 최대 5건 제한(ERROR-335) — 범위를 클램프해 맛보기 모드로 동작시킨다
  if (key === 'sample') end = Math.min(end, start + 4)
  const url = this.buildUrl(base, key, type, service, start, end, path)
  // …이하 기존 로직 동일 (cache/request/parse/unwrap)
}
```
주의: `isSample`(일반 키 기준)과 fetchAll의 sample 캡은 기존 동작 유지 — 변경하지 말 것.

`src/index.ts` 수정 — isCli 블록 안, `new SeoulApiClient()` 이전에:
```ts
import { loadDotEnv } from './client/env.js'
// …
if (isCli) {
  loadDotEnv() // 명시적 env가 우선이므로 Claude Desktop/Code의 env 주입과 충돌 없음
  const client = new SeoulApiClient()
  // …기존 로직
}
```

`.env.example` 생성:
```
# 서울 열린데이터광장 일반 인증키 — https://data.seoul.go.kr → 로그인 → 인증키 신청
SEOUL_API_KEY=
# 지하철 실시간 도착 전용 인증키 — 열린데이터광장에서 별도 신청 (미설정 시 SEOUL_API_KEY 사용)
SEOUL_SUBWAY_API_KEY=
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/env.test.ts tests/seoulApi.test.ts && npm test && npm run build`
Expected: 전부 PASS (기존 78개 포함), 빌드 클린

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dotenv loader and dedicated subway API key with fallback chain"
```

---

### Task 2: 픽스처 캡처 확장 + 카탈로그 28개 + 무결성 테스트

**Files:**
- Create: `src/data/catalog.ts`, `tests/catalog.test.ts`
- Modify: `scripts/capture-fixtures.ts` (신규 6종 추가)
- Test: `tests/catalog.test.ts`

**Interfaces:**
- Produces:
  - `interface DatasetParam { name: string; required: boolean; example: string; description: string }`
  - `interface DatasetEntry { id: string; name: string; category: Category6; description: string; responseType: 'json' | 'xml'; endpoint: 'open' | 'subway'; pathParams: DatasetParam[]; sampleFields: string[]; tool?: string; callable: boolean }`
  - `const CATALOG: DatasetEntry[]` (28개)
  - `function searchCatalog(query: string): DatasetEntry[]` (상위 5)
  - `function validateCall(entry: DatasetEntry, params: string[]): string | null` — 문제 없으면 null, 있으면 한국어 안내문

- [ ] **Step 1: 픽스처 캡처 스크립트 확장 후 실행**

`scripts/capture-fixtures.ts`의 `targets`에 추가 (검증된 파라미터 고정):
```ts
  'subway_stats.json': 'http://openapi.seoul.go.kr:8088/sample/json/CardSubwayStatsNew/1/5/20260801',
  'bus_stats.json': 'http://openapi.seoul.go.kr:8088/sample/json/CardBusStatisticsServiceNew/1/5/20260801',
  'living_pop.json': 'http://openapi.seoul.go.kr:8088/sample/json/SPOP_LOCAL_RESD_DONG/1/5/',
  'realestate.json': 'http://openapi.seoul.go.kr:8088/sample/json/tbLnOpendataRtmsV/1/5/',
  'pharmacy.json': 'http://openapi.seoul.go.kr:8088/sample/json/TbPharmacyOperateInfo/1/5/',
  'accinfo.xml': 'http://openapi.seoul.go.kr:8088/sample/xml/AccInfo/1/5/',
```
그리고 루프에 호출 간격 추가: `await new Promise(r => setTimeout(r, 1200))` (ERROR-337 회피).

Run: `npx tsx scripts/capture-fixtures.ts`
Expected: 기존 8 + 신규 6 = 14개 저장, 전부 200. 신규 6개 파일에 `INFO-000` 확인. **캡처된 필드명이 이 플랜의 catalog sampleFields·Task 4/5 정규화 필드와 다르면 픽스처가 정답 — 코드를 맞추고 보고서에 기록.**

- [ ] **Step 2: Write the failing test**

`tests/catalog.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CATALOG, searchCatalog, validateCall } from '../src/data/catalog.js'

describe('CATALOG 무결성', () => {
  it('정확히 28개, id 유일', () => {
    expect(CATALOG).toHaveLength(28)
    expect(new Set(CATALOG.map(e => e.id)).size).toBe(28)
  })
  it('카테고리는 6종만', () => {
    const cats = new Set(CATALOG.map(e => e.category))
    expect([...cats].sort()).toEqual(['교통·이동', '문화·여가', '보건·복지', '부동산·경제', '생활·인구', '안전·환경'])
  })
  it('required 파라미터는 example 필수', () => {
    for (const e of CATALOG) for (const p of e.pathParams) if (p.required) expect(p.example.length).toBeGreaterThan(0)
  })
  it('callable=false 항목은 tool 안내 필수', () => {
    for (const e of CATALOG.filter(x => !x.callable)) expect(e.tool).toBeTruthy()
  })
  it('XML 전용은 AccInfo와 citydata뿐', () => {
    expect(CATALOG.filter(e => e.responseType === 'xml').map(e => e.id).sort()).toEqual(['AccInfo', 'citydata'])
  })
})

describe('searchCatalog', () => {
  it('키워드로 관련 항목 상위 반환: 와이파이', () => {
    expect(searchCatalog('와이파이')[0].id).toBe('TbPublicWifiInfo')
  })
  it('정식 tool 있는 항목 검색: 지하철 승하차', () => {
    const top = searchCatalog('지하철 승하차')[0]
    expect(top.id).toBe('CardSubwayStatsNew')
    expect(top.tool).toBe('get_subway_ridership')
  })
  it('무관 키워드는 빈 배열 또는 낮은 관련 후보', () => {
    expect(searchCatalog('zzzz없는키워드')).toHaveLength(0)
  })
})

describe('validateCall', () => {
  const subway = CATALOG.find(e => e.id === 'CardSubwayStatsNew')!
  const disaster = CATALOG.find(e => e.id === 'LIVE_DST_MESSAGE')!
  it('required 누락 시 안내문', () => {
    expect(validateCall(subway, [])).toContain('USE_YMD')
  })
  it('required 충족 시 null', () => {
    expect(validateCall(subway, ['20260801'])).toBeNull()
  })
  it('callable=false는 tool 안내', () => {
    expect(validateCall(disaster, [])).toContain('get_disaster_alerts')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/catalog.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`src/data/catalog.ts` (sampleFields는 Step 1 픽스처와 대조해 필요 시 교정):
```ts
export type Category6 = '교통·이동' | '생활·인구' | '부동산·경제' | '문화·여가' | '보건·복지' | '안전·환경'
export interface DatasetParam { name: string; required: boolean; example: string; description: string }
export interface DatasetEntry {
  id: string; name: string; category: Category6; description: string
  responseType: 'json' | 'xml'; endpoint: 'open' | 'subway'
  pathParams: DatasetParam[]; sampleFields: string[]
  tool?: string; callable: boolean
}

const E = (e: DatasetEntry) => e

export const CATALOG: DatasetEntry[] = [
  // ── 기존 v1 데이터셋 8종 (정식 tool 보유 — search가 tool로 안내) ──
  E({ id: 'citydata', name: '실시간 도시데이터(통합)', category: '생활·인구', description: '핫스팟 종합 현황: 인구 혼잡도, 도로, 날씨, 행사, 재난. 실시간 스냅샷', responseType: 'xml', endpoint: 'open', pathParams: [{ name: 'AREA_NM', required: true, example: '광화문·덕수궁', description: '핫스팟 장소명' }], sampleFields: ['AREA_NM', 'LIVE_PPLTN_STTS', 'ROAD_TRAFFIC_STTS', 'WEATHER_STTS', 'EVENT_STTS'], tool: 'get_city_snapshot', callable: true }),
  E({ id: 'citydata_ppltn', name: '실시간 인구', category: '생활·인구', description: '핫스팟 실시간 인구, 혼잡도, 성연령 비율, 12시간 예측', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'AREA_NM', required: true, example: '강남역', description: '핫스팟 장소명' }], sampleFields: ['AREA_CONGEST_LVL', 'AREA_PPLTN_MIN', 'AREA_PPLTN_MAX', 'FCST_PPLTN'], tool: 'get_population', callable: true }),
  E({ id: 'citydata_cmrcl', name: '실시간 상권', category: '부동산·경제', description: '신한카드 실시간 결제 기반 상권 현황, 업종별 소비', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'AREA_NM', required: true, example: '성수카페거리', description: '핫스팟 장소명(82곳)' }], sampleFields: ['AREA_CMRCL_LVL', 'AREA_SH_PAYMENT_CNT', 'CMRCL_RSB'], tool: 'get_commercial_activity', callable: true }),
  E({ id: 'bikeList', name: '따릉이 실시간 대여현황', category: '교통·이동', description: '공공자전거 따릉이 대여소별 잔여 대수, 거치율, 위치', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['stationName', 'parkingBikeTotCnt', 'rackTotCnt', 'stationLatitude', 'stationLongitude'], tool: 'get_bike_stations', callable: true }),
  E({ id: 'culturalEventInfo', name: '문화행사 정보', category: '문화·여가', description: '공연, 전시, 축제, 콘서트 등 문화행사 일정과 장소, 요금', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CODENAME', 'GUNAME', 'TITLE', 'DATE', 'PLACE', 'USE_FEE'], tool: 'search_cultural_events', callable: true }),
  E({ id: 'GetParkingInfo', name: '시영주차장 실시간', category: '교통·이동', description: '공영주차장 실시간 주차 가능 면수, 요금', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['PKLT_NM', 'ADDR', 'TPKCT', 'NOW_PRK_VHCL_CNT'], tool: 'get_parking', callable: true }),
  E({ id: 'RealtimeCityAir', name: '자치구별 실시간 대기환경', category: '안전·환경', description: '미세먼지 PM10 PM2.5 오존 대기질 등급, 자치구별', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['MSRSTN_NM', 'PM', 'FPM', 'CAI_GRD'], tool: 'get_air_quality', callable: true }),
  E({ id: 'realtimeStationArrival', name: '지하철 실시간 도착', category: '교통·이동', description: '지하철역 실시간 열차 도착 정보, 호선, 행선지', responseType: 'json', endpoint: 'subway', pathParams: [{ name: 'statnNm', required: true, example: '강남', description: '역명(역 접미사 제외)' }], sampleFields: ['subwayId', 'trainLineNm', 'arvlMsg2', 'bstatnNm'], tool: 'get_subway_arrivals', callable: true }),
  // ── 승격 tool 대상 신규 4종 + 파생 1종 ──
  E({ id: 'CardSubwayStatsNew', name: '지하철 일별 승하차 인원', category: '교통·이동', description: '지하철 역별 하루 승차 하차 인원 통계, 이용객 수', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'USE_YMD', required: true, example: '20260801', description: '사용일자 YYYYMMDD (보통 2~4일 전까지 제공)' }], sampleFields: ['USE_YMD', 'SBWY_ROUT_LN_NM', 'SBWY_STNS_NM', 'GTON_TNOPE', 'GTOFF_TNOPE'], tool: 'get_subway_ridership', callable: true }),
  E({ id: 'SPOP_LOCAL_RESD_DONG', name: '생활인구(행정동, 내국인)', category: '생활·인구', description: '행정동별 시간대별 생활인구 추계, 상주 유동 인구 통계', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'STDR_DE_ID', required: false, example: '20260810', description: '기준일자 YYYYMMDD' }, { name: 'TMZON_PD_SE', required: false, example: '14', description: '시간대 00~23' }, { name: 'ADSTRD_CODE_SE', required: false, example: '11680640', description: '행정동코드' }], sampleFields: ['STDR_DE_ID', 'TMZON_PD_SE', 'ADSTRD_CODE_SE', 'TOT_LVPOP_CO'], tool: 'get_living_population', callable: true }),
  E({ id: 'tbLnOpendataRtmsV', name: '부동산 실거래가', category: '부동산·경제', description: '아파트 주택 부동산 매매 실거래가, 거래 금액, 면적', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['RCPT_YR', 'CGG_NM', 'STDG_NM', 'BLDG_NM', 'THING_AMT'], tool: 'get_real_estate_prices', callable: true }),
  E({ id: 'TbPharmacyOperateInfo', name: '약국 운영정보', category: '보건·복지', description: '약국 위치, 전화번호, 요일별 운영시간', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['DUTYNAME', 'DUTYADDR', 'DUTYTEL1', 'DUTYTIME1S', 'DUTYTIME1C'], tool: 'find_pharmacies', callable: true }),
  E({ id: 'LIVE_DST_MESSAGE', name: '긴급재난문자', category: '안전·환경', description: '재난 안전 긴급 문자 발송 내역 (핫스팟 기준)', responseType: 'xml', endpoint: 'open', pathParams: [], sampleFields: ['DST_SE_NM', 'DST_MSG_CN'], tool: 'get_disaster_alerts', callable: false }),
  // ── 카탈로그 전용 신규 15종 (call_dataset으로 호출) ──
  E({ id: 'CardBusStatisticsServiceNew', name: '버스 노선별 승하차 인원', category: '교통·이동', description: '버스 노선별 하루 승차 하차 인원 통계', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'USE_YMD', required: true, example: '20260801', description: '사용일자 YYYYMMDD' }], sampleFields: ['USE_YMD', 'RTE_ID', 'RTE_NO', 'RTE_NM'], callable: true }),
  E({ id: 'AccInfo', name: '실시간 돌발상황(TOPIS)', category: '교통·이동', description: '도로 교통사고, 공사, 집회, 통제 등 실시간 돌발 정보', responseType: 'xml', endpoint: 'open', pathParams: [], sampleFields: ['acc_id', 'occr_date', 'acc_type', 'acc_info'], callable: true }),
  E({ id: 'SPOP_DAILYSUM_JACHI', name: '주민등록인구(자치구)', category: '생활·인구', description: '자치구별 일별 생활인구 합계 통계', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['STDR_DE_ID', 'SIGNGU_CODE_SE', 'SIGNGU_NM'], callable: true }),
  E({ id: 'TbPublicWifiInfo', name: '공공와이파이 위치', category: '생활·인구', description: '무료 공공 와이파이 WiFi 설치 위치, 장소', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['X_SWIFI_MGR_NO', 'X_SWIFI_WRDOFC', 'X_SWIFI_MAIN_NM'], callable: true }),
  E({ id: 'TbGtnHwcwP', name: '무더위쉼터', category: '생활·인구', description: '폭염 대비 무더위 쉼터 위치, 냉방 시설', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['YEAR', 'AREA_CD', 'FACILITY_TYPE1'], callable: true }),
  E({ id: 'tbLnOpendataRentV', name: '부동산 전월세가', category: '부동산·경제', description: '아파트 주택 전세 월세 임대차 실거래, 보증금', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['RCPT_YR', 'CGG_NM', 'STDG_NM'], callable: true }),
  E({ id: 'VwsmTrdarSelngQq', name: '골목상권 추정매출', category: '부동산·경제', description: '상권별 업종별 분기 추정 매출액 통계', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['STDR_YYQU_CD', 'TRDAR_SE_CD', 'TRDAR_SE_CD_NM'], callable: true }),
  E({ id: 'ListTraditionalMarket', name: '전통시장 현황', category: '부동산·경제', description: '전통시장 위치, 점포 수, 유형', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CGG', 'MRKT_NM', 'SHP', 'ADDR', 'TYPE', 'TELNO'], callable: true }),
  E({ id: 'ListNecessariesPricesService', name: '생필품 물가정보', category: '부동산·경제', description: '생활필수품 농수산물 시장별 가격, 물가', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['P_SEQ', 'M_NAME', 'A_NAME', 'A_PRICE'], callable: true }),
  E({ id: 'culturalSpaceInfo', name: '문화공간 정보', category: '문화·여가', description: '미술관, 박물관, 공연장, 문화시설 위치와 정보', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['SUBJCODE', 'FAC_NAME', 'ADDR'], callable: true }),
  E({ id: 'SearchParkInfoService', name: '도시공원 정보', category: '문화·여가', description: '공원 위치, 면적, 개원일, 주요 시설', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['PARK_NM', 'PARK_OTLN', 'AREA', 'OPEN_YMD'], callable: true }),
  E({ id: 'SeoulPublicLibraryInfo', name: '공공도서관 현황', category: '문화·여가', description: '도서관 위치, 운영시간, 휴관일', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['LBRRY_NAME', 'GU_CODE', 'ADRES'], callable: true }),
  E({ id: 'TbHospitalInfo', name: '병원 정보', category: '보건·복지', description: '병원 의원 위치, 진료과목, 전화번호', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['HPID', 'DUTYNAME', 'DUTYADDR', 'DUTYDIVNAM'], callable: true }),
  E({ id: 'ChildCareInfo', name: '어린이집 정보', category: '보건·복지', description: '어린이집 위치, 유형, 정원 보육 정보', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['SIGUNNAME', 'CRNAME', 'CRTYPENAME'], callable: true }),
  E({ id: 'TimeAverageAirQuality', name: '시간평균 대기질', category: '안전·환경', description: '측정시각 기준 자치구별 시간평균 대기오염 농도', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MSRMT_DT', required: true, example: '202608151100', description: '측정시각 YYYYMMDDHHMM(정시)' }], sampleFields: ['MSRMT_DT', 'MSRSTN_NM', 'NTDX', 'OZON'], callable: true }),
]

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

const bigrams = (s: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** name/description/category 부분일치 우선, 2-gram 겹침 보조 — 상위 5개 */
export function searchCatalog(query: string): DatasetEntry[] {
  const q = norm(query)
  if (!q) return []
  const scored = CATALOG.map(e => {
    const hay = norm(`${e.name} ${e.description} ${e.category}`)
    let score = 0
    for (const token of query.split(/\s+/).map(norm).filter(Boolean)) {
      if (token && hay.includes(token)) score += 10
    }
    const qb = bigrams(q), hb = bigrams(hay)
    let hit = 0
    for (const g of qb) if (hb.has(g)) hit++
    score += hit / Math.max(qb.size, 1)
    return { e, score }
  }).filter(x => x.score >= 1)
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map(x => x.e)
}

/** call_dataset 사전 검증 — 문제 없으면 null, 있으면 한국어 안내문 */
export function validateCall(entry: DatasetEntry, params: string[]): string | null {
  if (!entry.callable) {
    return `'${entry.id}'은(는) 직접 호출 대상이 아닙니다. 정식 tool '${entry.tool}'을(를) 사용하세요.`
  }
  const required = entry.pathParams.filter(p => p.required)
  if (params.length < required.length) {
    const spec = required.map(p => `${p.name}(예: ${p.example}) — ${p.description}`).join('; ')
    return `필수 경로 파라미터가 필요합니다: ${spec}. params 배열에 순서대로 전달하세요.`
  }
  return null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/catalog.test.ts && npm test && npm run build`
Expected: 전부 PASS. 캡처한 픽스처의 필드명과 catalog sampleFields가 다르면 catalog를 픽스처에 맞게 교정 후 보고서에 기록.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 28-entry dataset catalog with search/validate, capture 6 new fixtures"
```

---

### Task 3: 메타 tool 3개 (search_dataset / get_dataset_spec / call_dataset)

**Files:**
- Create: `src/tools/meta.ts`, `tests/meta.test.ts`

**Interfaces:**
- Consumes: `CATALOG`/`searchCatalog`/`validateCall` (Task 2), `Ctx`, `ok`, `client.getJson/getXml/getSubway`
- Produces: `function registerMetaTools(server: McpServer, ctx: Ctx): void` — tool 3개 등록

- [ ] **Step 1: Write the failing test**

`tests/meta.test.ts` (핸들러가 쓰는 순수 로직 — 라우팅 결정 함수를 분리해 테스트):
```ts
import { describe, it, expect } from 'vitest'
import { CATALOG } from '../src/data/catalog.js'
import { routeFor, clampLimit } from '../src/tools/meta.js'

describe('routeFor', () => {
  it('json+open → getJson', () => {
    const e = CATALOG.find(x => x.id === 'TbPublicWifiInfo')!
    expect(routeFor(e)).toBe('getJson')
  })
  it('xml → getXml', () => {
    const e = CATALOG.find(x => x.id === 'AccInfo')!
    expect(routeFor(e)).toBe('getXml')
  })
  it('subway 엔드포인트 → getSubway', () => {
    const e = CATALOG.find(x => x.id === 'realtimeStationArrival')!
    expect(routeFor(e)).toBe('getSubway')
  })
})

describe('clampLimit', () => {
  it('기본 10, 최대 50', () => {
    expect(clampLimit(undefined)).toBe(10)
    expect(clampLimit(3)).toBe(3)
    expect(clampLimit(500)).toBe(50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/meta.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/tools/meta.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { CATALOG, searchCatalog, validateCall, type DatasetEntry } from '../data/catalog.js'

export function routeFor(entry: DatasetEntry): 'getJson' | 'getXml' | 'getSubway' {
  if (entry.endpoint === 'subway') return 'getSubway'
  return entry.responseType === 'xml' ? 'getXml' : 'getJson'
}

export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), 50)
}

const findEntry = (id: string) => CATALOG.find(e => e.id.toLowerCase() === id.toLowerCase())

export function registerMetaTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_dataset',
    {
      title: 'Search the Seoul dataset catalog',
      description:
        'Search the curated catalog of 28 Seoul Open Data datasets by keyword; entries with a dedicated tool point you to it. ' +
        '카탈로그에서 데이터셋을 검색합니다. 정식 tool이 없는 데이터는 call_dataset으로 호출하세요.',
      inputSchema: { query: z.string().describe('키워드 (예: "와이파이", "실거래가", "무더위쉼터")') },
    },
    async ({ query }) => {
      const hits = searchCatalog(query).map(e => ({
        id: e.id, name: e.name, category: e.category, description: e.description,
        requiredParams: e.pathParams.filter(p => p.required).map(p => p.name),
        howToCall: e.tool ? `정식 tool '${e.tool}' 사용 권장` : `call_dataset(id: '${e.id}')`,
      }))
      return ok(
        { count: hits.length, datasets: hits, hint: hits.length === 0 ? '결과 없음 — 다른 키워드로 시도하거나 get_dataset_spec으로 id를 직접 확인하세요.' : undefined },
        { source: 'built-in catalog.ts (28 datasets)', sample: ctx.client.isSample },
      )
    },
  )

  server.registerTool(
    'get_dataset_spec',
    {
      title: 'Get dataset call specification',
      description:
        'Get the path parameters, response fields, and call example for a catalog dataset id. ' +
        'call_dataset 호출 전 파라미터 명세를 확인합니다.',
      inputSchema: { id: z.string().describe('카탈로그 데이터셋 id (예: "CardSubwayStatsNew")') },
    },
    async ({ id }) => {
      const e = findEntry(id)
      if (!e) {
        return ok(
          { id, found: false, candidates: searchCatalog(id).map(x => x.id) },
          { source: 'built-in catalog.ts', notes: ['미등재 id — candidates에서 고르거나 search_dataset을 사용하세요.'], sample: ctx.client.isSample },
        )
      }
      return ok(
        {
          id: e.id, name: e.name, category: e.category, responseType: e.responseType,
          pathParams: e.pathParams, sampleFields: e.sampleFields,
          dedicatedTool: e.tool ?? null, callable: e.callable,
          example: e.callable
            ? `call_dataset(id: '${e.id}', params: [${e.pathParams.filter(p => p.required).map(p => `'${p.example}'`).join(', ')}])`
            : `정식 tool '${e.tool}' 사용`,
        },
        { source: 'built-in catalog.ts', sample: ctx.client.isSample },
      )
    },
  )

  server.registerTool(
    'call_dataset',
    {
      title: 'Call a catalog dataset (raw fields)',
      description:
        'Invoke a catalog dataset by id and get RAW (non-normalized) rows; check get_dataset_spec first for required params. ' +
        '카탈로그 데이터셋을 직접 호출합니다. 응답은 정규화되지 않은 원본 필드입니다.',
      inputSchema: {
        id: z.string().describe('카탈로그 데이터셋 id'),
        params: z.array(z.string()).optional().describe('경로 파라미터 (get_dataset_spec의 pathParams 순서대로)'),
        limit: z.number().int().optional().describe('최대 행 수 (기본 10, 최대 50)'),
      },
    },
    async ({ id, params, limit }) => {
      const e = findEntry(id)
      if (!e) {
        return ok(
          { id, found: false, candidates: searchCatalog(id).map(x => x.id) },
          { source: 'built-in catalog.ts', notes: ['미등재 id는 호출할 수 없습니다(카탈로그 한정). candidates 또는 search_dataset을 사용하세요.'], sample: ctx.client.isSample },
        )
      }
      const problem = validateCall(e, params ?? [])
      if (problem) {
        return ok(
          { id: e.id, called: false, spec: e.pathParams },
          { source: `열린데이터광장 ${e.id}`, notes: [problem], sample: ctx.client.isSample },
        )
      }
      const n = clampLimit(limit)
      const u = await ctx.client[routeFor(e)](e.id, 1, n, params ?? [])
      return ok(
        { id: e.id, name: e.name, count: u.rows.length, totalCount: u.totalCount, rows: u.rows.slice(0, n) },
        {
          source: `열린데이터광장 ${e.id}`,
          notes: [
            '비정규화 원본 필드입니다 — 필드 의미는 get_dataset_spec의 sampleFields 참고.',
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

Run: `npx vitest run tests/meta.test.ts && npm run build`
Expected: PASS + 빌드 클린

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: catalog meta tools — search_dataset, get_dataset_spec, call_dataset"
```

---

### Task 4: 승격 tool — 승하차 통계 · 생활인구 · 실거래가

**Files:**
- Create: `src/normalize/stats.ts`, `src/tools/stats.ts`, `tests/stats.test.ts`

**Interfaces:**
- Consumes: `client.getJson`, `ok`, `num`, 픽스처 subway_stats.json / living_pop.json / realestate.json (Task 2 캡처)
- Produces:
  - `interface SubwayRidership { date: string; line: string; station: string; boardings: number | null; alightings: number | null }` / `normalizeSubwayRidership(rows)`
  - `interface LivingPopulation { date: string; timeSlot: string; dongCode: string; total: number | null }` / `normalizeLivingPopulation(rows)`
  - `interface RealEstateDeal { year: string; district: string; dong: string; building: string; amount: number | null; area: number | null; floor: number | null; contractDate: string; use: string }` / `normalizeRealEstate(rows)`
  - `function registerStatsTools(server: McpServer, ctx: Ctx): void` — 3개 tool
  - **필드명은 픽스처가 정답** — 아래 매핑이 픽스처와 다르면 코드·테스트를 픽스처에 맞추고 보고

- [ ] **Step 1: Write the failing test**

`tests/stats.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { num } from '../src/normalize/util.js'
import { normalizeSubwayRidership, normalizeLivingPopulation, normalizeRealEstate } from '../src/normalize/stats.js'

const subwayRows = unwrap('CardSubwayStatsNew', JSON.parse(readFileSync('tests/fixtures/subway_stats.json', 'utf8'))).rows
const popRows = unwrap('SPOP_LOCAL_RESD_DONG', JSON.parse(readFileSync('tests/fixtures/living_pop.json', 'utf8'))).rows
const rtmsRows = unwrap('tbLnOpendataRtmsV', JSON.parse(readFileSync('tests/fixtures/realestate.json', 'utf8'))).rows

describe('normalizeSubwayRidership — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeSubwayRidership(subwayRows)
    expect(a.length).toBe(subwayRows.length)
    subwayRows.forEach((r: any, i: number) => {
      expect(a[i].date).toBe(r.USE_YMD ?? '')
      expect(a[i].line).toBe(r.SBWY_ROUT_LN_NM ?? '')
      expect(a[i].station).toBe(r.SBWY_STNS_NM ?? '')
      expect(a[i].boardings).toBe(num(r.GTON_TNOPE))
      expect(a[i].alightings).toBe(num(r.GTOFF_TNOPE))
    })
  })
})

describe('normalizeLivingPopulation — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeLivingPopulation(popRows)
    popRows.forEach((r: any, i: number) => {
      expect(a[i].date).toBe(String(r.STDR_DE_ID ?? ''))
      expect(a[i].timeSlot).toBe(String(r.TMZON_PD_SE ?? ''))
      expect(a[i].dongCode).toBe(String(r.ADSTRD_CODE_SE ?? ''))
      expect(a[i].total).toBe(num(r.TOT_LVPOP_CO))
    })
  })
})

describe('normalizeRealEstate — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeRealEstate(rtmsRows)
    rtmsRows.forEach((r: any, i: number) => {
      expect(a[i].year).toBe(String(r.RCPT_YR ?? ''))
      expect(a[i].district).toBe(r.CGG_NM ?? '')
      expect(a[i].dong).toBe(r.STDG_NM ?? '')
      expect(a[i].amount).toBe(num(r.THING_AMT))
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stats.test.ts`
Expected: FAIL — 모듈 없음 (필드명이 픽스처와 다르면 이 단계에서 드러남 — 테스트·코드 양쪽을 픽스처 필드명으로 교정)

- [ ] **Step 3: 구현**

`src/normalize/stats.ts`:
```ts
import { num } from './util.js'

export interface SubwayRidership { date: string; line: string; station: string; boardings: number | null; alightings: number | null }
export function normalizeSubwayRidership(rows: any[]): SubwayRidership[] {
  return rows.map(r => ({
    date: r.USE_YMD ?? '',
    line: r.SBWY_ROUT_LN_NM ?? '',
    station: r.SBWY_STNS_NM ?? '',
    boardings: num(r.GTON_TNOPE),
    alightings: num(r.GTOFF_TNOPE),
  }))
}

export interface LivingPopulation { date: string; timeSlot: string; dongCode: string; total: number | null }
export function normalizeLivingPopulation(rows: any[]): LivingPopulation[] {
  return rows.map(r => ({
    date: String(r.STDR_DE_ID ?? ''),
    timeSlot: String(r.TMZON_PD_SE ?? ''),
    dongCode: String(r.ADSTRD_CODE_SE ?? ''),
    total: num(r.TOT_LVPOP_CO),
  }))
}

export interface RealEstateDeal { year: string; district: string; dong: string; building: string; amount: number | null; area: number | null; floor: number | null; contractDate: string; use: string }
export function normalizeRealEstate(rows: any[]): RealEstateDeal[] {
  return rows.map(r => ({
    year: String(r.RCPT_YR ?? ''),
    district: r.CGG_NM ?? '',
    dong: r.STDG_NM ?? '',
    building: r.BLDG_NM ?? '',
    amount: num(r.THING_AMT),          // 물건금액(만원)
    area: num(r.ARCH_AREA),            // 건물면적 — 픽스처에 없으면 픽스처 필드로 교정
    floor: num(r.FLR),
    contractDate: String(r.CTRT_DAY ?? ''),
    use: r.BLDG_USG ?? '',
  }))
}
```

`src/tools/stats.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeSubwayRidership, normalizeLivingPopulation, normalizeRealEstate } from '../normalize/stats.js'

export function registerStatsTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_subway_ridership',
    {
      title: 'Daily subway ridership statistics',
      description:
        'Get per-station daily subway boarding/alighting counts for a date (data available up to ~2-4 days ago). ' +
        '지하철 역별 일별 승하차 인원. "강남역 하루 승객 몇 명?" 류 질문에 사용.',
      inputSchema: {
        date: z.string().regex(/^\d{8}$/).describe('사용일자 YYYYMMDD (오늘 데이터는 없음 — 보통 2~4일 전까지 제공)'),
        station: z.string().optional().describe('역명 필터 (부분일치, 예: "강남")'),
        line: z.string().optional().describe('호선 필터 (부분일치, 예: "2호선")'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 건수 (기본 20)'),
      },
    },
    async ({ date, station, line, limit }) => {
      const u = await ctx.client.getJson('CardSubwayStatsNew', 1, 1000, [date])
      let rows = normalizeSubwayRidership(u.rows)
      if (station) rows = rows.filter(r => r.station.includes(station.replace(/역$/, '')))
      if (line) rows = rows.filter(r => r.line.includes(line))
      return ok(
        { date, count: rows.length, ridership: rows.slice(0, limit ?? 20) },
        {
          source: '지하철 일별 승하차 (CardSubwayStatsNew)', asOf: date,
          notes: [
            '배치 통계 — 보통 2~4일 전 데이터까지 제공됩니다.',
            ...(rows.length === 0 ? ['해당 날짜 데이터가 없습니다. 더 이전 날짜로 시도하세요.'] : []),
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )

  server.registerTool(
    'get_living_population',
    {
      title: 'Living population by administrative dong',
      description:
        'Get de-facto (living) population estimates by administrative dong and hour. ' +
        '행정동·시간대별 생활인구 통계. 실시간 아님 — 실시간 혼잡은 get_population 사용.',
      inputSchema: {
        date: z.string().regex(/^\d{8}$/).optional().describe('기준일자 YYYYMMDD (약 5일 지연)'),
        timeSlot: z.string().regex(/^\d{2}$/).optional().describe('시간대 00~23 (date와 함께 사용)'),
        dongCode: z.string().optional().describe('행정동코드 8자리 (date, timeSlot과 함께 사용)'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 건수 (기본 20)'),
      },
    },
    async ({ date, timeSlot, dongCode, limit }) => {
      // 경로 파라미터는 앞에서부터 연속 지정된 것까지만 사용 (API 위치 기반)
      const path: string[] = []
      if (date) { path.push(date); if (timeSlot) { path.push(timeSlot); if (dongCode) path.push(dongCode) } }
      const n = limit ?? 20
      const u = await ctx.client.getJson('SPOP_LOCAL_RESD_DONG', 1, Math.max(n, 100), path)
      let rows = normalizeLivingPopulation(u.rows)
      if (dongCode && path.length < 3) rows = rows.filter(r => r.dongCode === dongCode)
      if (timeSlot && path.length < 2) rows = rows.filter(r => r.timeSlot === timeSlot)
      return ok(
        { count: rows.length, population: rows.slice(0, n) },
        {
          source: '생활인구 행정동 (SPOP_LOCAL_RESD_DONG)',
          notes: ['배치 통계(약 5일 지연). 대용량이므로 date/timeSlot/dongCode로 좁혀 조회하세요.', ...(u.note ? [u.note] : [])],
          sample: ctx.client.isSample,
        },
      )
    },
  )

  server.registerTool(
    'get_real_estate_prices',
    {
      title: 'Real estate transaction prices',
      description:
        'Get Seoul real-estate sale transaction records (price in 만원), filterable by district/dong/year. ' +
        '부동산 매매 실거래가. "강남구 아파트 실거래가?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().optional().describe('자치구명 (예: "강남구")'),
        dong: z.string().optional().describe('법정동명 (예: "역삼동")'),
        year: z.string().regex(/^\d{4}$/).optional().describe('접수연도 YYYY'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ district, dong, year, limit }) => {
      const u = await ctx.client.getJson('tbLnOpendataRtmsV', 1, 200)
      let rows = normalizeRealEstate(u.rows)
      if (district) rows = rows.filter(r => r.district.includes(district.replace(/구$/, '')))
      if (dong) rows = rows.filter(r => r.dong.includes(dong.replace(/동$/, '')))
      if (year) rows = rows.filter(r => r.year === year)
      return ok(
        { count: rows.length, deals: rows.slice(0, limit ?? 10) },
        {
          source: '부동산 실거래가 (tbLnOpendataRtmsV)',
          notes: ['amount 단위: 만원. 최근 접수분 200건 내 필터 결과입니다 — 더 좁히려면 district/dong/year를 지정하세요.', ...(u.note ? [u.note] : [])],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stats.test.ts && npm test && npm run build`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: promoted stats tools — subway ridership, living population, real estate"
```

---

### Task 5: 승격 tool — 약국 · 긴급재난문자

**Files:**
- Create: `src/normalize/health.ts`, `src/tools/health.ts`, `tests/health.test.ts`
- Modify: `src/normalize/citydata.ts` (extractDisasterAlerts 추가), `src/tools/common.ts` (get_disaster_alerts 추가), `tests/citydata.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: `client.getJson/getXml`, `ok`, `resolvePlace`, `num`/`toArray`, `inner`(citydata.ts 내부 헬퍼), 픽스처 pharmacy.json / citydata.xml
- Produces:
  - `interface Pharmacy { name: string; address: string; tel: string; hours: Record<string, string> }` / `normalizePharmacies(rows)`
  - `function extractDisasterAlerts(citydata: any): Array<{ category: string; message: string; sentAt: string }>`
  - `function registerHealthTools(server: McpServer, ctx: Ctx): void`

- [ ] **Step 1: Write the failing tests**

`tests/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizePharmacies } from '../src/normalize/health.js'

const rows = unwrap('TbPharmacyOperateInfo', JSON.parse(readFileSync('tests/fixtures/pharmacy.json', 'utf8'))).rows

describe('normalizePharmacies — 매핑 동등성 (재캡처 안전)', () => {
  it('이름/주소/전화 매핑 일치', () => {
    const a = normalizePharmacies(rows)
    expect(a.length).toBe(rows.length)
    rows.forEach((r: any, i: number) => {
      expect(a[i].name).toBe(r.DUTYNAME ?? '')
      expect(a[i].address).toBe(r.DUTYADDR ?? '')
      expect(a[i].tel).toBe(r.DUTYTEL1 ?? '')
    })
  })
  it('요일별 운영시간: 월요일 키 존재, HHMM-HHMM 형식 또는 빈 문자열', () => {
    const a = normalizePharmacies(rows)
    expect(a[0].hours).toHaveProperty('월')
    expect(a[0].hours['월']).toMatch(/^(\d{4}-\d{4}|)$/)
  })
})
```

`tests/citydata.test.ts`에 추가 (기존 import에 `extractDisasterAlerts` 추가):
```ts
  it('재난문자: 배열 반환 (없으면 빈 배열 — 픽스처 캡처 시점 기준)', () => {
    const alerts = extractDisasterAlerts(citydata)
    expect(Array.isArray(alerts)).toBe(true)
    for (const a of alerts) {
      expect(typeof a.message).toBe('string')
      expect(typeof a.sentAt).toBe('string')
    }
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/health.test.ts tests/citydata.test.ts`
Expected: FAIL — 모듈/함수 없음. pharmacy.json의 실제 필드명이 다르면(예: DUTYTIME1S 부재) 픽스처에 맞춰 코드·테스트를 교정하고 보고.

- [ ] **Step 3: 구현**

`src/normalize/health.ts`:
```ts
export interface Pharmacy { name: string; address: string; tel: string; hours: Record<string, string> }

const DAYS = ['월', '화', '수', '목', '금', '토', '일', '공휴일'] as const

/** DUTYTIME{n}S/{n}C (n=1~8: 월~일, 공휴일) → { 월: '0900-1900', ... } (미운영 요일은 '') */
export function normalizePharmacies(rows: any[]): Pharmacy[] {
  return rows.map(r => {
    const hours: Record<string, string> = {}
    DAYS.forEach((day, idx) => {
      const s = r[`DUTYTIME${idx + 1}S`]
      const c = r[`DUTYTIME${idx + 1}C`]
      hours[day] = s != null && c != null && String(s).length >= 3 ? `${String(s).padStart(4, '0')}-${String(c).padStart(4, '0')}` : ''
    })
    return { name: r.DUTYNAME ?? '', address: r.DUTYADDR ?? '', tel: r.DUTYTEL1 ?? '', hours }
  })
}
```

`src/normalize/citydata.ts`에 추가 (기존 `inner`/`toArray` 재사용):
```ts
export interface DisasterAlert { category: string; message: string; sentAt: string }

/** citydata의 LIVE_DST_MESSAGE 블록 → 재난문자 배열 (블록 부재/빈 값이면 []) */
export function extractDisasterAlerts(citydata: any): DisasterAlert[] {
  const block = inner(citydata, 'LIVE_DST_MESSAGE')
  return toArray(block?.DST_MESSAGE_STTS ?? block).filter((m: any) => m && (m.DST_MSG_CN ?? m.MSG_CN)).map((m: any) => ({
    category: m.DST_SE_NM ?? m.DST_GRD_SE ?? '',
    message: m.DST_MSG_CN ?? m.MSG_CN ?? '',
    sentAt: m.DST_RCPTN_DT ?? m.RCPTN_DT ?? '',
  }))
}
```
주의: 픽스처 citydata.xml에 재난문자 블록이 없거나 필드명이 다르면 **파싱된 픽스처 구조가 정답** — 실제 키 경로로 교정. 캡처 시점에 재난문자가 없어 빈 블록이면 빈 배열 동작만 테스트되는 것이 정상.

`src/tools/health.ts`:
```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizePharmacies } from '../normalize/health.js'

export function registerHealthTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'find_pharmacies',
    {
      title: 'Find pharmacies with operating hours',
      description:
        'Find Seoul pharmacies by district or name keyword, with per-day operating hours. ' +
        '약국 위치·전화·요일별 운영시간. "강남구 약국 몇 시까지 해?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().optional().describe('자치구/주소 키워드 (예: "강남구", "역삼동")'),
        name: z.string().optional().describe('약국명 키워드'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ district, name, limit }) => {
      const rows = await ctx.client.fetchAll('TbPharmacyOperateInfo', { max: 1000, pageSize: 1000 })
      let list = normalizePharmacies(rows)
      if (district) list = list.filter(p => p.address.includes(district))
      if (name) list = list.filter(p => p.name.includes(name))
      return ok(
        { count: list.length, pharmacies: list.slice(0, limit ?? 10) },
        {
          source: '약국 운영정보 (TbPharmacyOperateInfo)',
          notes: [
            '최근 1,000건 내 필터 결과입니다 — district로 좁혀 조회하세요.',
            ...(list.length === 0 ? ['조건에 맞는 약국이 없습니다.'] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
```

`src/tools/common.ts`의 `registerCommonTools` 안에 추가 (import에 `extractDisasterAlerts` 추가):
```ts
  server.registerTool(
    'get_disaster_alerts',
    {
      title: 'Emergency disaster alerts near a hotspot',
      description:
        'Get recent emergency disaster text alerts (긴급재난문자) issued for a Seoul hotspot area. ' +
        '핫스팟 지역 긴급재난문자. "지금 재난문자 온 거 있어?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const alerts = extractDisasterAlerts(u.rows[0] ?? {})
      return ok(
        { place: r.name, count: alerts.length, alerts },
        {
          source: 'OA-21285 (citydata LIVE_DST_MESSAGE, 행정안전부 연계)',
          notes: alerts.length === 0 ? ['현재 이 지역에 수신된 긴급재난문자가 없습니다.'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/health.test.ts tests/citydata.test.ts && npm test && npm run build`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: promoted tools — find_pharmacies and get_disaster_alerts"
```

---

### Task 6: 조립(TOOL_NAMES 19) + 버전 0.2.0 + README 갱신

**Files:**
- Modify: `src/index.ts`, `tests/smoke.test.ts`, `package.json`, `manifest.json`, `README.md`, `README.ko.md`

**Interfaces:**
- Consumes: `registerMetaTools`(T3), `registerStatsTools`(T4), `registerHealthTools`(T5), `loadDotEnv`(T1)
- Produces: TOOL_NAMES 19개 (아래 순서 그대로 — smoke/README와 일치해야 함)

- [ ] **Step 1: Write the failing test**

`tests/smoke.test.ts`의 배열을 교체:
```ts
    expect(TOOL_NAMES).toEqual([
      'search_place', 'get_city_snapshot', 'get_disaster_alerts',
      'get_population', 'get_commercial_activity',
      'get_subway_arrivals', 'get_bike_stations', 'get_parking', 'get_road_traffic',
      'search_cultural_events',
      'get_air_quality', 'get_weather',
      'get_subway_ridership', 'get_living_population', 'get_real_estate_prices', 'find_pharmacies',
      'search_dataset', 'get_dataset_spec', 'call_dataset',
    ])
```
그리고 catalog↔tool 정합 테스트를 `tests/catalog.test.ts`에 추가:
```ts
  it('catalog의 tool 필드는 실제 TOOL_NAMES에 존재', async () => {
    const { TOOL_NAMES } = await import('../src/index.js')
    for (const e of CATALOG.filter(x => x.tool)) expect(TOOL_NAMES).toContain(e.tool!)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/smoke.test.ts tests/catalog.test.ts`
Expected: FAIL — TOOL_NAMES 불일치

- [ ] **Step 3: 구현**

`src/index.ts`: TOOL_NAMES를 위 19개로 교체, `SERVER_VERSION = '0.2.0'`, import·buildServer에 `registerMetaTools/registerStatsTools/registerHealthTools` 추가, isCli 블록 첫 줄에 `loadDotEnv()` (Task 1에서 이미 했으면 확인만).
`package.json`: `"version": "0.2.0"`.
`manifest.json`: `"version": "0.2.0"`, description에 tool 수 갱신, `user_config`에 추가:
```json
    "seoul_subway_api_key": {
      "type": "string",
      "title": "Subway Realtime API Key",
      "description": "지하철 실시간 도착 전용 인증키 (열린데이터광장에서 별도 신청). 비우면 일반 키를 사용합니다.",
      "sensitive": true,
      "required": false
    }
```
그리고 `server.mcp_config.env`에 `"SEOUL_SUBWAY_API_KEY": "${user_config.seoul_subway_api_key}"` 추가.
`README.md` / `README.ko.md` 갱신(두 파일 동일 구조 유지):
- Tools 표를 19개로 — 카테고리(공통/생활인구/교통/문화/환경/통계/보건/카탈로그) 소제목 행으로 구분
- 커버리지 문구를 카테고리 6종 정식 명칭으로 교정: **고궁·문화유산, 관광특구, 공원, 발달상권, 인구밀집지역** (v1 최종 리뷰 지적 반영 — 고궁·문화유산 누락 수정)
- API Key 섹션에 키 2종 + `.env` 사용법 추가: `.env.example`를 `.env`로 복사해 키 입력 (git 미추적 명시)
- 예시 프롬프트에 2개 추가: "어제 강남역 승하차 몇 명이야?", "서울 공공와이파이 데이터 찾아줘"

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run build`
Expected: 전부 PASS (기존 + 신규). smoke 19개 통과

- [ ] **Step 5: JSON-RPC 왕복 스모크**

Run:
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | node dist/index.js | tail -1 | grep -o '"name":"[a-z_]*"' | wc -l
```
Expected: `19`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: assemble v0.2.0 — 19 tools, subway key user_config, bilingual README refresh"
```

---

### Task 7: 라이브 스위프 + RUN_LIVE 확장

**Files:**
- Create: `scripts/live-sweep.ts`
- Modify: `tests/live.test.ts` (케이스 2개 추가)

**Interfaces:**
- Consumes: 완성된 19개 tool, `.env`(로컬 키 — 없으면 sample), `loadDotEnv`

- [ ] **Step 1: live.test.ts 케이스 추가**

```ts
// 기존 live describe 안에 추가
  it('CardSubwayStatsNew: 날짜 파라미터 경로 검증', async () => {
    const u = await client.getJson('CardSubwayStatsNew', 1, 5, ['20260801'])
    expect(u.rows.length).toBeGreaterThan(0)
    expect(u.rows[0]).toHaveProperty('SBWY_STNS_NM')
  }, 20_000)

  it('catalog call 경로: TbPublicWifiInfo 5행', async () => {
    const u = await client.getJson('TbPublicWifiInfo', 1, 5)
    expect(u.rows.length).toBeGreaterThan(0)
  }, 20_000)
```
파일 상단에서 클라이언트 생성 전 `loadDotEnv()` 호출 추가 (`import { loadDotEnv } from '../src/client/env.js'`) — 로컬 `.env`의 실키로 라이브 검증 가능.

- [ ] **Step 2: live-sweep 스크립트 작성**

`scripts/live-sweep.ts` — 19개 tool을 stdio JSON-RPC로 순차 호출(호출 간 1.3초), tool별 ✓/✗ 요약 출력. 실행: `npx tsx scripts/live-sweep.ts`
```ts
// 19개 tool 전수 라이브 스위프 — 호출당 서버 프로세스 1개, 간격 1.3초 (샘플 키 제한 회피)
import { spawnSync } from 'node:child_process'

const CALLS: Array<[string, Record<string, unknown>]> = [
  ['search_place', { query: '강남' }],
  ['get_city_snapshot', { place: '광화문' }],
  ['get_disaster_alerts', { place: '광화문' }],
  ['get_population', { place: '광화문' }],
  ['get_commercial_activity', { place: '광화문' }],
  ['get_subway_arrivals', { station: '강남' }],
  ['get_bike_stations', { query: '망원' }],
  ['get_parking', { query: '세종로' }],
  ['get_road_traffic', { place: '광화문' }],
  ['search_cultural_events', { district: '강동구', limit: 2 }],
  ['get_air_quality', { district: '중구' }],
  ['get_weather', { place: '광화문' }],
  ['get_subway_ridership', { date: '20260801', station: '강남' }],
  ['get_living_population', { limit: 3 }],
  ['get_real_estate_prices', { limit: 3 }],
  ['find_pharmacies', { district: '중구', limit: 3 }],
  ['search_dataset', { query: '와이파이' }],
  ['get_dataset_spec', { id: 'TbPublicWifiInfo' }],
  ['call_dataset', { id: 'TbPublicWifiInfo', limit: 3 }],
]

let ok = 0
for (const [i, [name, args]] of CALLS.entries()) {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sweep', version: '0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  ].join('\n') + '\n'
  const proc = spawnSync('node', ['dist/index.js'], { input, encoding: 'utf8', timeout: 60_000 })
  const line = proc.stdout.trim().split('\n').find(l => l.includes('"id":2'))
  let verdict = '✗ 응답 없음'
  if (line) {
    const msg = JSON.parse(line)
    verdict = msg.result && !msg.result.isError ? '✓' : `✗ ${JSON.stringify(msg.result?.content?.[0]?.text ?? msg.error).slice(0, 60)}`
  }
  if (verdict === '✓') ok++
  console.log(`${name.padEnd(26)} ${verdict}`)
  if (i < CALLS.length - 1) await new Promise(r => setTimeout(r, 1300))
}
console.log(`\n성공 ${ok}/${CALLS.length}`)
process.exit(ok === CALLS.length ? 0 : 1)
```

- [ ] **Step 3: 실행 검증**

Run: `npm run build && npx tsx scripts/live-sweep.ts`
Expected: **19/19 ✓** (.env의 실키 기준. get_subway_ridership가 날짜 데이터 부재로 0건이어도 isError가 아니면 ✓ — note 안내가 동작 증거). 오프라인 `npm test`는 라이브 케이스 skip으로 여전히 green이어야 함.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: 19-tool live sweep script and expanded RUN_LIVE cases"
```

---

## Self-Review 결과 (플랜 작성자 체크)

- 스펙 §2 신규 데이터 20종 매핑: 승격 5(T4×3, T5×2 — 재난문자는 citydata 파서), 카탈로그 15(T2). 제외 3종(ERROR-500)은 카탈로그 미등재로 스펙 §1 비목표 준수
- 스펙 §3 구조: catalog.ts(T2), meta.ts(T3), stats/health(T4/5), 조립(T6). `endpoint` 필드는 스펙 스키마의 문서화된 확장(파일 구조 절에 명시 — SDD 원장 기록 대상)
- 스펙 §3.5 .env: T1(로더+subwayKey+.env.example) + T6(manifest user_config) + T7(live가 .env 로드)
- 스펙 §4 테스트: 픽스처 캡처(T2), 카탈로그 무결성(T2)+tool 정합(T6), 메타 가드(T2 validateCall + T3 라우팅), 매핑 동등성(T4/T5), RUN_LIVE 확장(T7), smoke 19(T6)
- 타입 일관성: `DatasetEntry`(T2)를 T3이 소비, `registerMetaTools/StatsTools/HealthTools`(T3/4/5)를 T6이 소비, `loadDotEnv`(T1)를 T6/T7이 소비 — 시그니처 일치 확인
- 의도적 결정 2건: ① T3 메타 tool 핸들러는 순수 로직(routeFor/clampLimit/validateCall)만 단위 테스트 — v1 tool 핸들러 관례와 동일, 배선은 T7 스위프가 검증 ② find_pharmacies는 첫 1,000건 내 클라이언트 필터(전수 아님) — note로 고지

