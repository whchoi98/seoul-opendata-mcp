# Seoul OpenData MCP

[![version](https://img.shields.io/badge/version-0.2.0-blue)](./CHANGELOG.md) [![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](./package.json)

[한국어 README 보기](./README.ko.md)

An [MCP](https://modelcontextprotocol.io) server that wraps Seoul's real-time city data (Seoul Open Data Plaza) so Claude — or any MCP client — can answer questions like:

> "지금 강남역 혼잡도 어때?" / **"Is Gangnam crowded right now?"**

...using live population, commercial-activity, subway, bike-share, parking, road-traffic, cultural-event, air-quality and weather data, plus batch statistics (subway ridership, living population, real-estate prices), pharmacy operating hours, and a searchable catalog of 28 raw Seoul Open Data datasets — for Seoul, with zero setup beyond an API key.

## Quick Start — Claude Desktop

Add this to your `claude_desktop_config.json` ([config file location](https://modelcontextprotocol.io/quickstart/user)):

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

Restart Claude Desktop and the 19 tools below become available.

## Claude Code

```bash
claude mcp add seoul-opendata -e SEOUL_API_KEY=YOUR_KEY -- npx -y seoul-opendata-mcp
```

## Getting API Keys (5 minutes)

The server works out of the box in **sample mode** (see limits below), but real keys remove the limits and are free:

1. Sign in (or sign up) at [data.seoul.go.kr](https://data.seoul.go.kr).
2. Open the authentication-key request page ("인증키 신청") and submit the short application form.
3. The key is issued immediately — no waiting for approval.
4. Put it in `SEOUL_API_KEY` (as shown above) and restart your MCP client.

Without `SEOUL_API_KEY`, the server falls back to a built-in `sample` key: the `citydata`-family tools (`get_city_snapshot`, `get_population`, `get_commercial_activity`, `get_road_traffic`, `get_weather`, `get_disaster_alerts`) only work for the single **광화문·덕수궁 (Gwanghwamun·Deoksugung)** hotspot, and the other tools return at most **5 rows**. Every sample-mode response includes a note reminding you of this.

There are two keys in total:

- **`SEOUL_API_KEY`** — the general key, used by every tool except realtime subway arrivals.
- **`SEOUL_SUBWAY_API_KEY`** — a separate key for `get_subway_arrivals` (realtime subway arrivals), requested independently on data.seoul.go.kr. Optional — if unset, the server falls back to `SEOUL_API_KEY`.

### Local development with `.env`

Copy `.env.example` to `.env` and fill in your key(s):

```bash
cp .env.example .env
# then edit .env: SEOUL_API_KEY=... (and optionally SEOUL_SUBWAY_API_KEY=...)
```

`.env` is listed in `.gitignore` and is never committed — only the empty `.env.example` template is tracked in the repo.

## Tools

19 tools grouped into 8 categories:

| Tool | Description | Key arguments |
|---|---|---|
| **Common** | | |
| `search_place` | Resolve a free-form place name to one of Seoul's 121 official real-time hotspots. Use this first when the user mentions a Seoul location. | `query` (string) |
| `get_city_snapshot` | One-shot combined snapshot (population/congestion + weather + road traffic + top events) of a hotspot. Best for broad "how is X right now?" questions. | `place` (string) |
| `get_disaster_alerts` | Recent emergency disaster text alerts (긴급재난문자) issued for a hotspot area. | `place` (string) |
| **Population & Commerce** | | |
| `get_population` | Real-time population, congestion level (여유/보통/약간 붐빔/붐빔), demographics, and optional 12-hour AI forecast. | `place` (string), `includeForecast` (boolean, optional) |
| `get_commercial_activity` | Real-time card-payment-based commercial activity level and per-industry breakdown (82 supported places). | `place` (string) |
| **Transit** | | |
| `get_subway_arrivals` | Real-time subway train arrivals for a station. | `station` (string), `limit` (1-30, default 10) |
| `get_bike_stations` | Find Ttareungi (서울 공공자전거) stations by name keyword and/or coordinates, with real-time available bike counts. | `query` (string, optional), `lat`/`lng` (optional), `radiusM` (default 500), `limit` (1-50, default 10) |
| `get_parking` | Real-time available spaces in Seoul public parking lots, filtered by a place/district keyword. | `query` (string), `limit` (1-50, default 10) |
| `get_road_traffic` | Average road speed, congestion message, and accident/control incidents around a hotspot. | `place` (string) |
| **Culture** | | |
| `search_cultural_events` | Search Seoul cultural events (concerts, exhibitions, festivals) by keyword/category/district/date range/free-only. | `keyword`, `category`, `district`, `from`, `to`, `freeOnly`, `limit` (all optional) |
| **Environment** | | |
| `get_air_quality` | Real-time air quality (PM10/PM2.5, grade) by district. Omit district for all 25. | `district` (string, optional) |
| `get_weather` | Current temperature, precipitation, fine dust (PM10/PM2.5), UV, sunrise/sunset and weather warnings at a hotspot. | `place` (string) |
| **Statistics (batch)** | | |
| `get_subway_ridership` | Per-station daily subway boarding/alighting counts for a date (data available up to ~2-4 days ago). | `date` (YYYYMMDD), `station`/`line` (optional filters), `limit` (1-100, default 20) |
| `get_living_population` | De-facto (living) population estimates by administrative dong and hour (batch, ~5-day lag). | `date` (YYYYMMDD, optional), `timeSlot` (00-23, optional), `dongCode` (optional), `limit` (1-100, default 20) |
| `get_real_estate_prices` | Seoul real-estate sale transaction records (price in 만원/10k KRW), filterable by district/dong/year. | `district`, `dong`, `year` (YYYY), `limit` (1-50, default 10) — all optional |
| **Health** | | |
| `find_pharmacies` | Find Seoul pharmacies by district or name keyword, with per-day operating hours. | `district`, `name`, `limit` (1-50, default 10) — all optional |
| **Catalog** | | |
| `search_dataset` | Search the curated catalog of 28 Seoul Open Data datasets by keyword (e.g. public WiFi, cooling shelters). | `query` (string) |
| `get_dataset_spec` | Get the path parameters, response fields, and a call example for a catalog dataset id. | `id` (string) |
| `call_dataset` | Call a catalog dataset by id and get raw (non-normalized) rows — for datasets without a dedicated tool. | `id` (string), `params` (string[], optional), `limit` (optional, default 10, max 50) |

## Coverage & Limits

- **121 official hotspots, 5 official categories** — `search_place`, `get_city_snapshot`, `get_population`, `get_road_traffic`, and `get_weather` only cover these named locations: palaces & cultural heritage (고궁·문화유산), tourist zones (관광특구), parks (공원), commercial districts (발달상권), and dense hotspots (인구밀집지역).
- **Commercial activity: 82 of the 121 hotspots** — `get_commercial_activity` returns `supported: false` with nearby alternatives for the other 39.
- **Population has ~15 minutes of delay** — it's a telecom-based estimate with correction, not instantaneous.
- **Free quota is ~1,000 calls/day per key** — the server caches responses in memory (60s for city data, 5 min for air/bike/parking, 1 hour for cultural events) to help stay within this.
- Bike stations, parking lots, air quality, cultural events, subway arrivals, pharmacies, and the batch statistics tools are **not** limited to the 121 hotspots — they cover their respective full Seoul-wide datasets (e.g. all 25 districts for air quality, ~3,000 bike stations).
- **Catalog tools cover 28 curated datasets** — `search_dataset` / `get_dataset_spec` / `call_dataset` give raw access to datasets that don't (yet) have a dedicated normalized tool.

## Data Attribution

Data is provided by the **Seoul Open Data Plaza** (서울 열린데이터광장, [data.seoul.go.kr](https://data.seoul.go.kr)) "Seoul Real-time City Data" (서울 실시간 도시데이터) service, which fuses telecom population data (KT/SKT), card-payment data (Shinhan Card), and transit tap-in/tap-out data (Tmoney), along with the Seoul public bike, parking, air-quality, cultural-event, and subway-arrival open APIs.

## Example Prompts

- "지금 강남역 혼잡도 어때?" — congestion level right now
- "홍대 앞으로 12시간 동안 인구가 어떻게 변할까?" — 12-hour population forecast
- "성수동 상권 요즘 분위기 어때?" — commercial activity trend
- "여의도 근처에 따릉이 자전거 있어?" — nearby Ttareungi bike availability
- "이번 주말 마포구 무료 공연 있어?" — free cultural events this weekend
- "오늘 강남구 미세먼지 어때?" — today's fine dust level
- "어제 강남역 승하차 몇 명이야?" — yesterday's boarding/alighting count at Gangnam station
- "서울 공공와이파이 데이터 찾아줘" — find Seoul's public WiFi dataset

## License

[MIT](./LICENSE) © 2026 whchoi98
