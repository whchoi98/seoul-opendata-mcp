# seoul-opendata-mcp v0.4.0 설계 스펙 — AgentCore Runtime 대응 + 세션 스케일링

- 날짜: 2026-08-19
- 상태: 설계 승인 대기
- 기반: v0.3.0 (main `51dfd3d`, tool 19개, 테스트 105+4)
- 근거 문서: AgentCore Runtime MCP 프로토콜 계약(공식), 세션 유입 대비 논의(2026-08-19)

## 1. 개요

stdio 전용인 현 서버에 **Streamable HTTP 진입점**을 추가해 Amazon Bedrock AgentCore Runtime(및 임의의 HTTPS MCP 클라이언트)에 배포 가능하게 하고, 세션 유입 증가 시 **업스트림 호출량이 세션 수의 함수가 되지 않도록** 캐시·쿼터 계층을 재설계한다.

### 목표
- AgentCore Runtime MCP 계약 충족: Streamable HTTP(stateless), `0.0.0.0:8000`, `POST /mcp`, `GET /ping`→`{"status":"Healthy"}`, ARM64 컨테이너
- 전역 2단 캐시(L1 microVM 메모리 + L2 DynamoDB TTL)로 세션 횡단 쿼터 보호 복원
- stale-while-revalidate + single-flight + 일일 쿼터 예산 회계로 쿼터 소진 시에도 우아한 저하
- 기존 배포 경로(stdio: npx/MCPB/Claude Code) **완전 무영향**

### 비목표 (v0.4.0 제외)
- **서울시 API 쿼터 상향 신청** — 수동 절차, 사용자 지시로 제외
- 수집기 분리(EventBridge 선수집 push 모델) — 유입 검증 후 별도 버전
- 실제 AWS 리소스 생성(Runtime/DynamoDB/ECR 배포) — 코드·컨테이너·문서까지가 범위, 배포 실행은 별도 확인 후
- AgentCore Gateway 연동 — Runtime 엔드포인트가 생기면 무변경 등록 가능(문서로만 안내)
- stateful MCP(elicitation/sampling) — 서버가 무상태이므로 불필요

## 2. HTTP 진입점 (src/http.ts)

| 항목 | 값 | 근거 |
|---|---|---|
| Transport | SDK `StreamableHTTPServerTransport`, **stateless** (`sessionIdGenerator: undefined`) | Runtime 기본 모드, 플랫폼 주입 `Mcp-Session-Id` 수용 |
| 바인딩 | `0.0.0.0:8000` (env `PORT`로 재정의 가능) | 계약 고정값 |
| 경로 | `POST /mcp` (JSON-RPC, `application/json`/`text/event-stream` 응답) · `GET /ping` → 200 `{"status":"Healthy"}` | 계약 |
| 요청 처리 | 요청마다 `buildServer(sharedClient)` + transport 신규 생성, **`SeoulApiClient`는 프로세스 전역 1개 공유**(L1 캐시 보존) | SDK stateless 패턴 |
| 기동 | `node dist/http.js` (stdio 진입점 `dist/index.js`와 병행 존재) | 기존 bin 불변 |
| 시작 로그 | stderr에만 (stdout은 HTTP 응답 전용 아님이지만 관례 유지) | |

`.env` 로더는 http 진입점에서도 기동 시 1회 호출(명시적 env 우선 — Runtime env 주입과 호환).

## 3. 컨테이너 (Dockerfile, .dockerignore)

- 멀티스테이지: `node:22-slim` 빌드(devDeps+tsc) → 런타임 스테이지(prod deps만, `npm ci --omit=dev`)
- **`--platform=linux/arm64`** (Runtime 요구; 빌드 호스트인 이 EC2가 ARM64라 네이티브)
- `EXPOSE 8000`, `CMD ["node", "dist/http.js"]`
- 이미지에 키·`.env` 미포함(.dockerignore: .env, tests, docs, .claude, .superpowers, node_modules, dist 등) — 키는 Runtime env로 주입
- 로컬 검증: `docker build` + `docker run -p 8000:8000` 후 `/ping`·`/mcp` 스모크 (docker 미설치 시 이 단계는 계획서에 조건부)

## 4. 캐시 재설계 (src/client/cache.ts 확장)

### 4.1 계층 구조

```
요청 → L1: InMemoryCache (microVM/프로세스 로컬, 현행 TtlCache 승계)
     → L2: DynamoDbCache (전역, env CACHE_TABLE_NAME 설정 시에만 활성)
     → single-flight 병합 → 서울 API
```

- `interface CacheBackend { get(key): Promise<CacheEntry | undefined>; set(key, entry): Promise<void> }` — **async화** (fetchUnwrapped는 이미 async)
- `CacheEntry = { value: Unwrapped; storedAt: epochMs; softTtlMs: number }` — soft(신선) / hard(stale 서빙 한도, 전 서비스 공통 24h) 이중 수명
- CompositeCache: L1 히트 → 즉시. L1 미스·L2 히트 → L1 채우고 반환. 양쪽 미스 → 업스트림.
- **L2 미설정 시(스탠드얼론 npx/MCPB/stdio) 동작은 현행과 동일** — L1만, 신규 의존성 로드도 없음(lazy dynamic import)

### 4.2 DynamoDbCache

- 의존성 추가: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` — **lazy dynamic import**로 `CACHE_TABLE_NAME` 설정 시에만 로드 (stdio 사용자 기동 비용 무영향; 패키지 용량 증가는 수용, mcpb 크기 재확인)
- 테이블 스키마(사용자가 사전 생성, 배포 문서에 CLI 한 줄 제공): PK `pk`(S) = URL 해시, attr `entry`(S, JSON), `expireAt`(N, DynamoDB TTL 속성 = storedAt+hardTtl)
- 항목 크기 가드: 380KB 초과 entry는 L2 기록 생략(L1만) — DynamoDB 400KB 한도
- L2 장애(권한/스로틀)는 **경고 로그 후 L1-only로 폴백** — 캐시 계층이 서비스를 죽이지 않음

### 4.3 single-flight (프로세스 내)

- URL별 진행 중 Promise 맵 — 동일 microVM 내 동시 요청은 업스트림 1회로 병합
- 크로스 VM 잠금은 비목표(경합 비용이 잠금 복잡도보다 저렴) — L2 read-before-fetch로 대부분 흡수

### 4.4 stale-while-revalidate

- soft 만료 & hard 이내: **stale 즉시 반환** + 백그라운드 갱신(fire-and-forget, 실패는 로그만). 응답 notes에 `데이터가 최신이 아닐 수 있습니다(캐시 경과 N분)` 추가
- hard 초과: 일반 미스로 처리

### 4.5 쿼터 예산 회계

- 일일 예산: env `QUOTA_DAILY_LIMIT`(기본 1000). 카운터는 L2 활성 시 DynamoDB 원자 증가 항목(`pk=quota#<keyHash>#<YYYYMMDD>`, KST 기준일), L2 미설정 시 프로세스 로컬 근사
- 모든 실제 업스트림 호출 직후 증가. 소비율에 따른 동작:
  - < 80%: 정상
  - ≥ 80%: 응답 notes에 잔여 경고 추가
  - ≥ 100%: **stale-only 모드** — 캐시(hard 이내)만 서빙, 미스는 쿼터 소진 안내 note와 함께 빈 결과(에러 아님, 기존 INFO-200 관례와 동일한 우아한 저하)
- 지하철 키는 별도 카운터(`keyHash`가 키별)

## 5. TTL 정렬 (원천 갱신 주기 기준 — 즉시 절감)

| 서비스 | 현행 | 변경 | 근거 |
|---|---|---|---|
| citydata / citydata_ppltn / citydata_cmrcl | 60s | **300s** | 원천 5분 주기 — 신선도 손실 0 |
| realtimeStationArrival | 15s | 15s 유지 | 실시간성 본질 |
| bikeList / GetParkingInfo / RealtimeCityAir | 300s | 300s 유지 | |
| culturalEventInfo | 1h | **6h** | 원천 1일 갱신 |
| CardSubwayStatsNew / CardBusStatisticsServiceNew / SPOP_LOCAL_RESD_DONG / SPOP_DAILYSUM_JACHI | (기본 60s) | **24h** | 배치 통계 |
| tbLnOpendataRtmsV / tbLnOpendataRentV | (기본 60s) | **6h** | 일 단위 접수분 |
| TbPharmacyOperateInfo / TbHospitalInfo / ChildCareInfo / 시설류 카탈로그 | (기본 60s) | **24h** | 준정적 |
| TimeAverageAirQuality / AccInfo | (기본 60s) | 1h / 5m | 원천 주기 |
| 기본값 | 60s | **1h** | 카탈로그 롱테일 대부분 준정적 |

hard TTL(스테일 서빙 한도)은 전 서비스 24h 공통.

## 6. 테스트

- `tests/http.test.ts`: http 서버 spawn → `GET /ping` 200 Healthy → `POST /mcp` initialize/tools/list 19개 → `Mcp-Session-Id` 임의 헤더 수용(거부 안 함) → 동시 POST 2건 정상
- `tests/cache2.test.ts`: CompositeCache — L1/L2 히트 경로, stale 서빙(＋notes), hard 만료, single-flight(동일 URL 동시 N회 → fetch 1회), L2 장애 폴백, 예산 회계(80%/100% 전이, 키별 분리) — **L2는 주입식 fake(인메모리 구현)로 테스트, 실 DynamoDB 미사용**
- 기존 109개 테스트 green 유지(캐시 async화에 따른 seoulApi.test.ts 갱신 허용 — 픽스처 불변)
- 라이브: live-sweep은 stdio 기준 유지 + http 스모크 1건 추가(로컬 서버)
- 컨테이너: docker 가용 시 build+run 스모크(플랜에서 조건부 단계)

## 7. 문서·배포 산출물

- README(양 언어): "AgentCore Runtime에 배포" 절 — 컨테이너 빌드→ECR→`agentcore` CLI 배포 개요, DynamoDB 캐시 테이블 생성 CLI, env 표(`CACHE_TABLE_NAME`, `QUOTA_DAILY_LIMIT`, `PORT`), Gateway 확장 경로 1단락
- `docs/runbooks/agentcore-deploy.md`: 배포·롤백 런북(리소스 생성 명령 포함 — 실행은 사용자 확인 후)
- ADR-004: 세션 스케일링 설계(2단 캐시·stale·예산 회계 — 세션 수와 쿼터의 분리 원칙)
- CHANGELOG `[Unreleased]`에 기재(버전 컷은 완료 후 별도)
- manifest/MCPB는 stdio 기준 그대로(변경 없음 확인만)

## 8. 리스크

| 리스크 | 대응 |
|---|---|
| aws-sdk 의존성으로 패키지 비대 | lazy import + 번들 실행 스모크로 크기·기동 회귀 확인 |
| 캐시 async화가 기존 경로 회귀 | 기존 테스트 109개가 게이트, 시그니처 변경은 client 내부에 국한 |
| DynamoDB 스로틀/권한 오류 | L1 폴백 + 경고 로그(서비스 무중단) |
| stale 데이터 오해 | notes에 경과 시간 명시(기존 지연 고지 관례 연장) |
| Runtime 계약 표류 | http.test가 계약(포트/경로/ping/세션 헤더)을 회귀 테스트로 고정 |

## 9. 마일스톤

1. 캐시 재설계(CacheBackend/Composite/single-flight/stale) + TTL 정렬 — stdio 경로에서 완결
2. 쿼터 예산 회계(+ DynamoDB 어댑터, fake 기반 테스트)
3. HTTP 진입점 + 계약 테스트
4. Dockerfile/.dockerignore + (조건부) 컨테이너 스모크
5. 문서(README/런북/ADR-004) + 번들 회귀(실행 스모크) + 라이브 스위프
