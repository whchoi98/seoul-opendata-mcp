# Seoul OpenData MCP

[![version](https://img.shields.io/badge/version-0.2.0-blue)](./CHANGELOG.md) [![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](./package.json)

[Read in English](./README.md)

서울시 실시간 도시데이터(서울 열린데이터광장)를 감싸는 [MCP](https://modelcontextprotocol.io) 서버입니다. Claude(또는 다른 MCP 클라이언트)가 다음과 같은 질문에 답할 수 있게 해줍니다.

> **"지금 강남역 혼잡도 어때?"** / "Is Gangnam crowded right now?"

인증키 하나만 있으면 서울의 실시간 인구, 상권, 지하철, 따릉이, 주차, 도로교통, 문화행사, 대기질, 날씨 데이터는 물론, 배치 통계(지하철 승하차, 생활인구, 부동산 실거래가), 약국 운영정보, 서울 열린데이터광장 28개 원본 데이터셋을 검색·호출할 수 있는 카탈로그까지 별도 설정 없이 바로 사용할 수 있습니다.

## Quick Start — Claude Desktop

`claude_desktop_config.json`([설정 파일 위치](https://modelcontextprotocol.io/quickstart/user))에 아래 내용을 추가하세요.

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

Claude Desktop을 재시작하면 아래 19개 tool을 바로 사용할 수 있습니다.

## Claude Code

```bash
claude mcp add seoul-opendata -e SEOUL_API_KEY=YOUR_KEY -- npx -y seoul-opendata-mcp
```

## API 키 발급 (5분)

인증키 없이도 **샘플 모드**로 바로 동작합니다(아래 한계 참고). 하지만 실제 키는 무료이고 이런 제한이 사라지니 발급을 권장합니다.

1. [data.seoul.go.kr](https://data.seoul.go.kr)에 로그인(또는 회원가입)합니다.
2. "인증키 신청" 페이지에서 간단한 신청서를 작성해 제출합니다.
3. 승인 대기 없이 즉시 발급됩니다.
4. 발급받은 키를 위 설정의 `SEOUL_API_KEY`에 넣고 MCP 클라이언트를 재시작하세요.

`SEOUL_API_KEY`를 설정하지 않으면 서버는 내장된 `sample` 키로 동작합니다. 이 경우 `citydata` 계열 tool(`get_city_snapshot`, `get_population`, `get_commercial_activity`, `get_road_traffic`, `get_weather`, `get_disaster_alerts`)은 **광화문·덕수궁** 단일 핫스팟 1곳만 조회 가능하고, 나머지 tool은 최대 **5건**까지만 반환됩니다. 샘플 모드 응답에는 이 제약을 알리는 안내가 항상 포함됩니다.

인증키는 총 2종입니다.

- **`SEOUL_API_KEY`** — 일반 인증키. 지하철 실시간 도착을 제외한 모든 tool이 사용합니다.
- **`SEOUL_SUBWAY_API_KEY`** — 지하철 실시간 도착(`get_subway_arrivals`) 전용 인증키. data.seoul.go.kr에서 별도로 신청합니다. 선택 항목이며, 설정하지 않으면 `SEOUL_API_KEY`를 대신 사용합니다.

### `.env`로 로컬 개발하기

`.env.example`을 `.env`로 복사한 뒤 키를 입력하세요.

```bash
cp .env.example .env
# 이후 .env를 편집: SEOUL_API_KEY=... (선택적으로 SEOUL_SUBWAY_API_KEY=...)
```

`.env`는 `.gitignore`에 등록되어 있어 절대 커밋되지 않습니다 — 저장소에는 값이 빈 `.env.example` 템플릿만 추적됩니다.

## Tools

19개 tool을 8개 카테고리로 나누어 제공합니다.

| Tool | 설명 | 주요 인자 |
|---|---|---|
| **공통** | | |
| `search_place` | 자연어 장소명을 서울 실시간 도시데이터 핫스팟 121곳 중 하나로 매칭합니다. 사용자가 서울의 특정 장소를 언급하면 가장 먼저 사용하세요. | `query` (문자열) |
| `get_city_snapshot` | 핫스팟의 인구/혼잡도 + 날씨 + 도로교통 + 주요 행사를 한 번에 조회합니다. "지금 홍대 어때?" 같은 포괄적 질문에 적합합니다. | `place` (문자열) |
| `get_disaster_alerts` | 핫스팟 지역에 발령된 최근 긴급재난문자를 조회합니다. | `place` (문자열) |
| **생활인구** | | |
| `get_population` | 실시간 인구, 혼잡도(여유/보통/약간 붐빔/붐빔), 성연령 비율, 선택적으로 12시간 AI 예측을 조회합니다. | `place` (문자열), `includeForecast` (불리언, 선택) |
| `get_commercial_activity` | 신한카드 실시간 결제 기반 상권 활성도와 업종별 현황을 조회합니다(지원 82곳). | `place` (문자열) |
| **교통** | | |
| `get_subway_arrivals` | 지하철역의 실시간 열차 도착 정보를 조회합니다. | `station` (문자열), `limit` (1~30, 기본 10) |
| `get_bike_stations` | 이름 키워드 및/또는 좌표로 따릉이 대여소를 찾고 실시간 잔여 대수를 조회합니다. | `query` (문자열, 선택), `lat`/`lng` (선택), `radiusM` (기본 500), `limit` (1~50, 기본 10) |
| `get_parking` | 장소/자치구 키워드로 서울 공영주차장의 실시간 주차 가능 면수를 조회합니다. | `query` (문자열), `limit` (1~50, 기본 10) |
| `get_road_traffic` | 핫스팟 주변의 평균 도로 속도, 소통 메시지, 사고/통제 현황을 조회합니다. | `place` (문자열) |
| **문화** | | |
| `search_cultural_events` | 키워드/분류/자치구/기간/무료 여부로 서울시 문화행사(공연·전시·축제)를 검색합니다. | `keyword`, `category`, `district`, `from`, `to`, `freeOnly`, `limit` (모두 선택) |
| **환경** | | |
| `get_air_quality` | 자치구별 실시간 대기질(PM10/PM2.5, 등급)을 조회합니다. 자치구를 생략하면 25개 전체를 반환합니다. | `district` (문자열, 선택) |
| `get_weather` | 핫스팟 기준 현재 기온, 강수, 미세먼지(PM10/PM2.5), 자외선, 일출/일몰, 기상특보를 조회합니다. | `place` (문자열) |
| **통계(배치)** | | |
| `get_subway_ridership` | 지하철 역별 일별 승하차 인원을 조회합니다(보통 2~4일 전 데이터까지 제공). | `date` (YYYYMMDD), `station`/`line` (선택 필터), `limit` (1~100, 기본 20) |
| `get_living_population` | 행정동·시간대별 생활인구 통계를 조회합니다(배치, 약 5일 지연). | `date` (YYYYMMDD, 선택), `timeSlot` (00~23, 선택), `dongCode` (선택), `limit` (1~100, 기본 20) |
| `get_real_estate_prices` | 서울 부동산 매매 실거래가(단위: 만원)를 자치구/법정동/연도로 필터링해 조회합니다. | `district`, `dong`, `year` (YYYY), `limit` (1~50, 기본 10) — 모두 선택 |
| **보건** | | |
| `find_pharmacies` | 자치구 또는 약국명 키워드로 서울 약국을 찾고 요일별 운영시간을 조회합니다. | `district`, `name`, `limit` (1~50, 기본 10) — 모두 선택 |
| **카탈로그** | | |
| `search_dataset` | 서울 열린데이터광장 카탈로그(28개 데이터셋)를 키워드로 검색합니다(예: 공공와이파이, 무더위쉼터). | `query` (문자열) |
| `get_dataset_spec` | 카탈로그 데이터셋 id의 경로 파라미터, 응답 필드, 호출 예시를 확인합니다. | `id` (문자열) |
| `call_dataset` | 정식 tool이 없는 카탈로그 데이터셋을 id로 직접 호출해 원본(비정규화) 데이터를 가져옵니다. | `id` (문자열), `params` (문자열 배열, 선택), `limit` (선택, 기본 10, 최대 50) |

## 커버리지와 한계

- **핫스팟 121곳, 정식 카테고리 5종** — `search_place`, `get_city_snapshot`, `get_population`, `get_road_traffic`, `get_weather`는 지정된 121개 장소만 지원합니다: 고궁·문화유산, 관광특구, 공원, 발달상권, 인구밀집지역.
- **상권은 121곳 중 82곳만 지원** — `get_commercial_activity`는 나머지 39곳에 대해 `supported: false`와 인접 대안 장소를 반환합니다.
- **인구는 약 15분 지연** — 통신사 집계 기반 추정치에 보정을 거치기 때문에 실시간이 아닙니다.
- **무료 쿼터는 키당 하루 약 1,000회** — 서버는 메모리 캐시(도시데이터 60초, 대기질/따릉이/주차 5분, 문화행사 1시간)로 쿼터 소진을 완화합니다.
- 따릉이 대여소, 공영주차장, 대기질, 문화행사, 지하철 도착 정보, 약국, 배치 통계 tool은 121개 핫스팟에 한정되지 않고 서울 전역 데이터를 다룹니다(예: 대기질은 25개 자치구 전체, 따릉이는 약 3천 개 대여소).
- **카탈로그 tool은 28개 큐레이션 데이터셋을 다룹니다** — `search_dataset` / `get_dataset_spec` / `call_dataset`은 아직 정규화된 정식 tool이 없는 데이터셋을 원본 그대로 조회할 수 있게 해줍니다.

## 데이터 출처 고지

이 서버는 **서울 열린데이터광장**([data.seoul.go.kr](https://data.seoul.go.kr))의 **'서울 실시간 도시데이터'** 서비스를 사용합니다. 이 데이터는 통신사(KT/SKT) 인구 데이터, 신한카드 결제 데이터, 티머니(Tmoney) 대중교통 승하차 데이터를 융합한 것이며, 서울시 공공자전거·주차장·대기환경·문화행사·지하철 도착정보 오픈 API도 함께 사용합니다.

## 예시 프롬프트

- "지금 강남역 혼잡도 어때?" — 실시간 혼잡도
- "홍대 앞으로 12시간 동안 인구가 어떻게 변할까?" — 12시간 인구 예측
- "성수동 상권 요즘 분위기 어때?" — 상권 활성도 추이
- "여의도 근처에 따릉이 자전거 있어?" — 인근 따릉이 잔여 대수
- "이번 주말 마포구 무료 공연 있어?" — 주말 무료 문화행사
- "오늘 강남구 미세먼지 어때?" — 오늘의 미세먼지 수준
- "어제 강남역 승하차 몇 명이야?" — 어제 강남역 승하차 인원
- "서울 공공와이파이 데이터 찾아줘" — 공공와이파이 데이터셋 검색

## 라이선스

[MIT](./LICENSE) © 2026 whchoi98
