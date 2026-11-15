# API Reference

20 [MCP](https://modelcontextprotocol.io) tools exposed by `seoul-opendata-mcp` v0.5.0, grouped as they are registered in `src/index.ts` / `src/tools/*.ts`. Input schemas below are transcribed from each tool's `zod` `inputSchema` in source; output summaries list the fields of the `data` payload before it is wrapped in the common response envelope.

## Protocol

This is not a REST API. The server speaks MCP over **stdio** (`StdioServerTransport`, `dist/index.js`) for local clients: connect via `npx -y seoul-opendata-mcp` (see `README.md`) or `claude mcp add`. For Amazon Bedrock AgentCore Runtime it also speaks **Streamable HTTP** (`dist/http.js`, stateless): `POST /mcp` on `0.0.0.0:8000` and `GET /ping` for health (see `docs/runbooks/agentcore-deploy.md`). Either way, call tools by name with a JSON arguments object, matching each Input Schema table below.

## Authentication

Two environment variables, read by `SeoulApiClient` (`src/client/seoulApi.ts`) directly from `process.env` or from a local `.env` file (`src/client/env.ts`):

| Variable | Required | Used by | Fallback when unset |
|---|---|---|---|
| `SEOUL_API_KEY` | No | Every tool except `get_subway_arrivals` | Built-in `sample` key (scope-limited, see below) |
| `SEOUL_SUBWAY_API_KEY` | No | `get_subway_arrivals` only | Falls back to `SEOUL_API_KEY` |

Get a free key at [data.seoul.go.kr](https://data.seoul.go.kr) -> sign in -> "인증키 신청" (5 minutes, issued immediately).

**Sample mode** — when `SEOUL_API_KEY` is unset, `SeoulApiClient.isSample` is `true`: `citydata`-family tools (`get_city_snapshot`, `get_population`, `get_commercial_activity`, `get_road_traffic`, `get_weather`, `get_disaster_alerts`) only return data for **광화문·덕수궁** (Gwanghwamun/Deoksugung), and every other tool is capped at **5 rows**. Every affected response carries a note in `notes[]` pointing back to the key-signup URL.

## Response Envelope

Every tool (see `src/tools/envelope.ts`) returns MCP content of the form:

```json
{
  "data": { "...": "tool-specific payload, see each tool below" },
  "asOf": "ISO-8601 timestamp, or the upstream's own measurement time",
  "source": "human-readable citation of the upstream API/dataset",
  "notes": ["zero or more advisory strings, e.g. sample-mode or empty-result explanations"]
}
```

`asOf` defaults to the request time but is overridden with the upstream's own measurement timestamp wherever the domain data carries one (e.g. `measuredAt`).

## Tool Index

| Tool | Category | Purpose |
|---|---|---|
| `search_place` | Place resolution | Resolve free-form text to one of 121 hotspots |
| `get_city_snapshot` | Place resolution | One-shot population + weather + road + events summary |
| `get_disaster_alerts` | Place resolution | Recent emergency disaster text alerts near a hotspot |
| `get_population` | Population / commercial | Real-time population, congestion, demographics, forecast |
| `get_commercial_activity` | Population / commercial | Real-time card-payment commercial activity level |
| `get_subway_arrivals` | Traffic | Real-time subway train arrivals for a station |
| `get_bike_stations` | Traffic | Ttareungi (public bike) station availability |
| `get_parking` | Traffic | Public parking lot availability |
| `get_road_traffic` | Traffic | Road speed/congestion and incidents near a hotspot |
| `search_cultural_events` | Culture | Search concerts/exhibitions/festivals by filter |
| `get_air_quality` | Environment | Real-time air quality by district |
| `get_weather` | Environment | Weather, fine dust, UV, warnings at a hotspot |
| `get_subway_ridership` | Statistics | Daily per-station subway boarding/alighting counts |
| `get_living_population` | Statistics | De-facto population by administrative dong and hour |
| `get_real_estate_prices` | Real estate | Real-estate sale and rent transaction records |
| `get_land_price` | Real estate | Officially assessed land price per m² for a parcel |
| `find_pharmacies` | Health | Pharmacy locations with per-day operating hours |
| `search_dataset` | Meta / catalog | Search the 29-dataset catalog by keyword |
| `get_dataset_spec` | Meta / catalog | Get call parameters/fields for a catalog dataset |
| `call_dataset` | Meta / catalog | Call any catalog dataset, get raw (non-normalized) rows |

---

## Place Resolution Tools

### `search_place`

Resolve a free-form place name to one of Seoul's 121 official real-time hotspots. Use this first whenever the user mentions a Seoul location by a casual name.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Free-form place name, e.g. `"강남역"`, `"홍대"`, `"코엑스"`, `"Gangnam"` |

**Output Summary**

- `match` — matched `{name, category, commercial}` hotspot, or `null`
- `candidates` — up to 5 near-miss hotspots when there is no exact match
- `totalHotspots` — `121`
- `hint` — guidance string when `match` is `null`

**Example question** — "What's the official hotspot name for Gangnam Station?" / "강남역 정식 핫스팟 이름이 뭐야?"

### `get_city_snapshot`

Combined snapshot (population/congestion + weather + road + top events) of a hotspot in one call. Prefer this for broad "how is X right now?" questions.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `place` | `string` | Yes | Hotspot place name |

**Output Summary**

- `place` — resolved hotspot name
- `population` — full `Population` object (see `get_population` below)
- `weatherSummary` — one-line composed string (temperature, precipitation, PM2.5 level)
- `roadMessage` — current road-congestion message
- `events` — up to 5 `{name, period, place}` cultural/city events

**Example question** — "How is Hongdae right now?" / "지금 홍대 어때?"

### `get_disaster_alerts`

Recent emergency disaster text alerts (긴급재난문자) issued for a hotspot area.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `place` | `string` | Yes | Hotspot place name |

**Output Summary**

- `place` — resolved hotspot name
- `count` — number of alerts
- `alerts` — `{category, message, sentAt}[]`

**Example question** — "Any emergency alerts near Gwanghwamun right now?" / "지금 광화문 근처 재난문자 온 거 있어?"

---

## Population / Commercial Tools

### `get_population`

Real-time population, congestion level, demographics, and optional 12-hour AI forecast for a hotspot.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `place` | `string` | Yes | Hotspot place name (prefer the `name` confirmed by `search_place`) |
| `includeForecast` | `boolean` | No | Include the next-12-hour population forecast (default `false`) |

**Output Summary**

- `place`, `code` — hotspot name and area code
- `congestionLevel` — one of `여유`/`보통`/`약간 붐빔`/`붐빔`
- `congestionMessage` — human-readable congestion description
- `populationMin` / `populationMax` — estimated population range
- `malePct` / `femalePct` — gender ratio
- `agePct` — `{'0s'…'70s+': number|null}` age-band ratios
- `residentPct` / `nonResidentPct` — resident vs. visitor ratio
- `measuredAt` — upstream measurement timestamp
- `forecast` — `{at, congestionLevel, min, max}[]`, populated only when `includeForecast: true`

Note: real-time population is delayed roughly 15 minutes and is a relative congestion indicator, not an exact count.

**Example question** — "Is Gangnam Station crowded right now?" / "지금 강남역 혼잡해?"

### `get_commercial_activity`

Real-time card-payment based commercial activity level (4 levels) and per-industry breakdown. Supported for 82 of the 121 hotspots.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `place` | `string` | Yes | Hotspot place name (commercial data covers 82 places only) |

**Output Summary — supported place**

- `place`, `level` — one of `한산한`→`분주한` (4 levels)
- `paymentCount`, `paymentAmountMin`, `paymentAmountMax` — aggregate card-payment stats
- `measuredAt` — upstream measurement timestamp
- `categories` — per-industry `{large, mid, level, paymentCount, amountMin, amountMax, merchantCount}[]`

**Output Summary — unsupported place**

- `place`, `supported: false`, `alternatives` — up to 5 nearby/same-category hotspots that do support this tool

Note: this is a card-payment sample (신한카드), not a full transaction count — interpret `level` as "busier/quieter than usual," not an absolute figure.

**Example question** — "How's business in Seongsu right now?" / "지금 성수동 장사 잘돼?"

---

## Traffic Tools

### `get_subway_arrivals`

Real-time subway train arrivals for a station.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `station` | `string` | Yes | Station name, without the `역` suffix if possible, e.g. `"강남"` |
| `limit` | `number` (int, 1-30) | No | Max results (default 10) |

**Output Summary**

- `station` — normalized station name used for the query
- `arrivals` — `{line, direction, destination, trainLine, secondsToArrival, arrivalMessage, currentLocation, receivedAt}[]`

**Example question** — "When's the next train at Gangnam on line 2?" / "2호선 강남역 열차 언제 와?"

### `get_bike_stations`

Seoul public bike (따릉이) stations by name keyword and/or coordinates, with real-time available-bike counts.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | No | Station-name keyword, e.g. `"망원"`, `"강남역"` |
| `lat` | `number` | No | Center latitude (used with `radiusM`) |
| `lng` | `number` | No | Center longitude |
| `radiusM` | `number` | No | Search radius in meters (default 500) |
| `limit` | `number` (int, 1-50) | No | Max results (default 10) |

At least one of `query` or (`lat` + `lng`) is required.

**Output Summary**

- `count` — number of matched stations
- `stations` — `{id, name, available, racks, ratePct, lat, lng, distanceM?}[]`

**Example question** — "Any Ttareungi bikes available near Mangwon?" / "망원 근처 따릉이 있어?"

### `get_parking`

Real-time available spaces in Seoul public parking lots, filtered by a place/district keyword matched against lot name and address.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Place/district keyword, e.g. `"종로"`, `"세종로"`, `"강남"` |
| `limit` | `number` (int, 1-50) | No | Max results (default 10) |

**Output Summary**

- `count` — number of matched lots
- `lots` — `{code, name, address, totalSpaces, occupied, available, realtimeYn, baseFee, baseMinutes, updatedAt}[]`

Note: only ~122 realtime-linked lots report a current vehicle count.

**Example question** — "Is there parking available in Jongno?" / "종로 주차 자리 있어?"

### `get_road_traffic`

Average road speed, congestion message, and accident/control incidents around a hotspot.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `place` | `string` | Yes | Hotspot place name |

**Output Summary**

- `place`, `message`, `index` — congestion message and index
- `averageSpeedKmh` — average measured road speed
- `measuredAt` — upstream measurement timestamp
- `incidents` — `{type, detail, occurredAt, message}[]`

**Example question** — "Is traffic bad near Gwanghwamun?" / "광화문 근처 길 막혀?"

---

## Culture Tools

### `search_cultural_events`

Search Seoul cultural events (concerts, exhibitions, festivals) by keyword/category/district/date-range/free-only.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `keyword` | `string` | No | Event-title keyword (server-side `TITLE` search) |
| `category` | `string` | No | Category, e.g. `콘서트`, `전시/미술`, `축제-문화/예술` |
| `district` | `string` | No | District (자치구), e.g. `마포구` |
| `from` | `string` | No | Range start, `YYYY-MM-DD` |
| `to` | `string` | No | Range end, `YYYY-MM-DD` |
| `freeOnly` | `boolean` | No | Free events only |
| `limit` | `number` (int, 1-50) | No | Max results (default 15) |

**Output Summary**

- `count` — number of matched events (after client-side filtering)
- `events` — `{category, district, title, period, startDate, endDate, place, fee, isFree, link}[]`

Note: `category`/`keyword` are applied server-side against up to 500 rows; `district`/`from`/`to`/`freeOnly` are applied client-side within that window.

**Example question** — "Any free concerts in Mapo this weekend?" / "이번 주말 마포구 무료 공연 있어?"

---

## Environment Tools

### `get_air_quality`

Real-time air quality (PM10/PM2.5, grade) for Seoul districts. Omit `district` to get all 25.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `district` | `string` | No | District name, e.g. `"강남구"`; omit for all 25 |

**Output Summary**

- `count` — number of matched districts
- `airQuality` — `{region, district, pm10, pm25, ozone, no2, co, so2, grade, index, mainPollutant, measuredAt}[]`

**Example question** — "How's the fine dust in Gangnam-gu today?" / "오늘 강남구 미세먼지 어때?"

### `get_weather`

Current temperature, precipitation, fine dust (PM10/PM2.5), UV, sunrise/sunset, and weather warnings for a hotspot.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `place` | `string` | Yes | Hotspot place name |

**Output Summary**

- `place`, `temperatureC`, `sensibleTemperatureC`, `maxTempC`, `minTempC`, `humidityPct`
- `precipitation`, `precipitationType`, `precipitationMessage`
- `sunrise`, `sunset`, `uvLevel`
- `pm10`, `pm10Level`, `pm25`, `pm25Level`, `airQualityIndex`, `airMessage`
- `warnings` — active weather-warning strings
- `measuredAt` — upstream measurement timestamp

**Example question** — "What's the weather like at Yeouido right now?" / "지금 여의도 날씨 어때?"

---

## Statistics Tools

### `get_subway_ridership`

Per-station daily subway boarding/alighting counts for a date (data available up to ~2-4 days ago; today's data does not exist).

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `date` | `string` (`/^\d{8}$/`) | Yes | Usage date, `YYYYMMDD` |
| `station` | `string` | No | Station-name filter (partial match), e.g. `"강남"` |
| `line` | `string` | No | Line filter (partial match), e.g. `"2호선"` |
| `limit` | `number` (int, 1-100) | No | Max results (default 20) |

**Output Summary**

- `date` — echoed input date
- `count` — number of matched rows
- `ridership` — `{date, line, station, boardings, alightings}[]`

**Example question** — "How many people rode Gangnam Station yesterday?" / "강남역 하루 승객 몇 명?"

### `get_living_population`

De-facto (living) population estimates by administrative dong and hour. Not realtime — use `get_population` for realtime congestion.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `date` | `string` (`/^\d{8}$/`) | No | Reference date, `YYYYMMDD` (~5 days delayed) |
| `timeSlot` | `string` (`/^\d{2}$/`) | No | Hour slot `00`-`23`, used together with `date` |
| `dongCode` | `string` | No | 8-digit administrative-dong code, used together with `date`/`timeSlot` |
| `limit` | `number` (int, 1-100) | No | Max results (default 20) |

Path parameters are positional upstream: only a prefix of `date` -> `timeSlot` -> `dongCode` actually narrows the request; trailing filters not passed as path params are applied client-side instead.

**Output Summary**

- `count` — number of matched rows
- `population` — `{date, timeSlot, dongCode, total}[]`

**Example question** — "What's the estimated living population for this dong at 2pm?" / "이 행정동 오후 2시 생활인구는 얼마나 돼?"

---

## Real Estate Tools

Registered in `src/tools/realestate.ts`. The upstream services filter by **position** in the URL path, so the tool fills skipped positions with a single space (`%20`); an empty string would drop every filter after it.

### `get_real_estate_prices`

Seoul real-estate transaction records, sales (`tbLnOpendataRtmsV`) or rentals (`tbLnOpendataRentV`), newest contract first. Amounts are in 만원 (10k KRW).

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `dealType` | `"sale"` \| `"rent"` | No | Transaction type (default `sale`) |
| `district` | `string` | No | District name, e.g. `"강남구"`; `"강남"` is completed to `"강남구"`. A name that is not one of the 25 Seoul districts returns an empty result without calling upstream |
| `dong` | `string` | No | Legal-dong name, e.g. `"역삼동"`. With `district` it is resolved to a legal-dong code and filtered upstream; without `district` it is matched by name within the latest 500 rows |
| `building` | `string` | No | Building name, partial match upstream (e.g. `"래미안"`) |
| `buildingUse` | `"아파트"` \| `"연립다세대"` \| `"단독다가구"` \| `"오피스텔"` | No | Building type, filtered upstream |
| `year` | `string` (`/^\d{4}$/`) | No | Filing year `YYYY`; omit for all years |
| `rentType` | `"전세"` \| `"월세"` | No | Rent only. Matched within the latest 500 rows (upstream has no such filter) |
| `includeCancelled` | `boolean` | No | Sale only. Include cancelled deals (default `false`) |
| `limit` | `number` (int, 1-50) | No | Max results (default 10) |

**Output Summary**

- `dealType`, and `district` / `dong` / `year` when given (`dong` is the resolved legal-dong name)
- `totalCount` — rows matching the upstream filters (year, district, legal dong, building name, building type)
- `count` — number of deals returned
- `deals` for `sale` — `{year, district, dong, building, amount, area, landArea, floor, contractDate, use, buildYear, dealMethod, rightType, cancelDate}[]`. `cancelDate` is non-empty only for cancelled deals
- `deals` for `rent` — `{year, district, dong, building, rentType, deposit, monthlyRent, area, floor, contractDate, contractPeriod, use, buildYear, contractType, renewalRightUsed, prevDeposit, prevMonthlyRent}[]`. `contractType` is `신규` or `갱신`; `prevDeposit` / `prevMonthlyRent` are set on renewals

**Behavior notes**

- One upstream call of 100 rows per query (500 when `rentType` or a name-matched `dong` is used), so different `limit` values share a cache entry.
- A `dong` with `district` costs one extra 1-row lookup against `IndividuallyPostedLandPriceService` to get the legal-dong code (cached 24 hours). An administrative-dong name such as `역삼1동` is retried as `역삼동`. If the dong is not found, the tool returns an empty result and does not call the transaction service.
- Cancelled sales (91 of the latest 1,000 rows for 2025 Gangnam-gu when measured) are removed unless `includeCancelled` is `true`; the number removed is reported in `notes`.

**Example question** — "What did apartments in Gangnam-gu sell for in 2025?" / "2025년 강남구 아파트 실거래가?", "타워팰리스 전세 보증금은?"

### `get_land_price`

Officially assessed individual land price (개별공시지가, KRW per m²) from `IndividuallyPostedLandPriceService`.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `district` | `string` | Yes | District name, e.g. `"강남구"` |
| `dong` | `string` | No | Legal-dong name, e.g. `"역삼동"` |
| `lotNumber` | `string` (`/^\d{1,4}(-\d{1,4})?$/`) | No | Lot number `main` or `main-sub`, e.g. `"737"`, `"633-7"`. Requires `dong` |
| `year` | `string` (`/^\d{4}$/`) | No | Base year. Omit to use the current year, falling back to the previous year when the current one is not published yet |
| `limit` | `number` (int, 1-50) | No | Max results (default 10) |

**Output Summary**

- `district`, `dong` (when given), `year` (the year actually answered)
- `totalCount` — parcels matching the filters; `count` — parcels returned
- `parcels` — `{year, district, dong, lotNumber, landType, pricePerSqm, baseDate, pnu}[]`. `lotNumber` is formatted like `633-7`; `pnu` is the 19-digit parcel number

Note: parcels come back in API order, not sorted by price. A district alone matches tens of thousands of parcels, so narrow with `dong` and `lotNumber`.

**Example question** — "What is the assessed land price of 737 Yeoksam-dong?" / "역삼동 737번지 공시지가?"

---

## Health Tools

### `find_pharmacies`

Seoul pharmacies by district or name keyword, with per-day operating hours.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `district` | `string` | No | District/address keyword, e.g. `"강남구"`, `"역삼동"` |
| `name` | `string` | No | Pharmacy-name keyword |
| `limit` | `number` (int, 1-50) | No | Max results (default 10) |

**Output Summary**

- `count` — number of matched pharmacies
- `pharmacies` — `{name, address, tel, hours}[]`, `hours` keyed by `월`/`화`/`수`/`목`/`금`/`토`/`일`/`공휴일` -> `"HHMM-HHMM"` or `""`

Note: filters are applied within the most recent 1,000 fetched rows only.

**Example question** — "Which pharmacies in Gangnam-gu are open late?" / "강남구 약국 몇 시까지 해?"

---

## Meta / Catalog Tools

These three tools give agents generic access to the 15 catalog datasets that do not have a dedicated tool (plus the 13 that do, as a lookup aid), without requiring a new MCP tool per dataset.

### `search_dataset`

Search the curated catalog of 29 Seoul Open Data datasets by keyword.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Keyword, e.g. `"와이파이"`, `"실거래가"`, `"무더위쉼터"` |

**Output Summary**

- `count` — number of matched datasets (top 5)
- `datasets` — `{id, name, category, description, requiredParams, howToCall}[]`
- `hint` — guidance string when `count` is `0`

**Example question** — "Is there a dataset about public wifi locations?" / "와이파이 위치 데이터셋 있어?"

### `get_dataset_spec`

Get the path parameters, response fields, and call example for a catalog dataset id.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Catalog dataset id, e.g. `"CardSubwayStatsNew"` |

**Output Summary — found**

- `id`, `name`, `category`, `responseType` (`json`/`xml`)
- `pathParams` — `{name, required, example, description}[]`
- `sampleFields` — representative raw field names
- `dedicatedTool` — tool name if one exists, else `null`
- `callable` — whether `call_dataset` accepts this id
- `example` — ready-to-use `call_dataset(...)` call string, or a pointer to the dedicated tool

**Output Summary — not found**

- `id`, `found: false`, `candidates` — nearest matching ids

**Example question** — "What parameters does the CardSubwayStatsNew dataset need?" / "CardSubwayStatsNew 데이터셋은 어떤 파라미터가 필요해?"

### `call_dataset`

Invoke a catalog dataset by id and get raw (non-normalized) rows. Check `get_dataset_spec` first for required parameters.

**Input Schema**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Catalog dataset id |
| `params` | `string[]` | No | Path parameters, in the order given by `get_dataset_spec`'s `pathParams`. They are positional: send a single space `" "` for a position you skip. A call that leaves a required position empty is rejected before reaching upstream |
| `limit` | `number` (int) | No | Max rows (default 10, clamped to 1-50) |

**Output Summary — success**

- `id`, `name`, `count`, `totalCount`, `rows` — raw upstream fields, un-normalized

**Output Summary — validation failure**

- `id`, `called: false`, `spec` — the dataset's `pathParams`, so the agent can retry with correct `params`

**Example question** — "Call the TbGtnHwcwP dataset and show me cooling shelters." / "TbGtnHwcwP 데이터셋 호출해서 무더위쉼터 보여줘."

---

## Error Handling

Upstream/client errors surface as `SeoulApiError` (`src/client/response.ts`), which the MCP SDK reports back to the caller. Notable codes:

| Code | Meaning |
|---|---|
| `INFO-000` | Success (never surfaced as an error) |
| `INFO-100` | Key-related error (missing/invalid/quota) — triggers the key-signup hint |
| `INFO-200` | No data available for the given query (not an error; surfaced as a `notes[]` string) |
| `HTTP-<status>` | Non-2xx HTTP response from the upstream, after one retry on 5xx (300 ms backoff) |
| `TIMEOUT` | Upstream did not answer within `timeoutMs` (15 s); not retried |
| `NETWORK` | Network failure, after one retry (300 ms backoff) |
| `PARSE` | Response body did not match any of the 8 known envelope shapes |

Every error message includes the masked key (`maskedKey()`/`maskedSubwayKey()`), never the raw value.

## Caching / Rate Behavior

`SeoulApiClient` caches unwrapped responses keyed by the full request URL in a two-tier cache: an in-process L1 (an LRU bounded at `MAX_L1_ENTRIES` = 1000) and, when `CACHE_TABLE_NAME` is set, a shared DynamoDB L2. Each service has a **soft TTL** aligned with how often its source updates (`SOFT_TTL` in `src/client/seoulApi.ts`); every entry has a 24 h **hard TTL** (`HARD_TTL_MS`).

| Services | Soft TTL |
|---|---|
| `realtimeStationArrival` | 15 seconds |
| `citydata`, `citydata_ppltn`, `citydata_cmrcl`, `bikeList`, `GetParkingInfo`, `RealtimeCityAir`, `AccInfo` | 5 minutes |
| `TimeAverageAirQuality` | 1 hour |
| `culturalEventInfo`, `tbLnOpendataRtmsV`, `tbLnOpendataRentV` | 6 hours |
| `CardSubwayStatsNew`, `CardBusStatisticsServiceNew`, `SPOP_LOCAL_RESD_DONG`, `SPOP_DAILYSUM_JACHI`, `TbPharmacyOperateInfo`, `TbHospitalInfo`, `ChildCareInfo`, `IndividuallyPostedLandPriceService` | 24 hours |
| Any other catalog dataset (via `call_dataset`) | 1 hour (`DEFAULT_SOFT_TTL`) |

Within the soft TTL a cached entry is served as-is. Between soft and hard TTL it is served immediately with a `notes[]` age disclosure while one background refresh runs (stale-while-revalidate); identical concurrent requests share one upstream call (single-flight).

A daily quota ledger (`QUOTA_DAILY_LIMIT`, default 1000 per key per KST day) adds a usage note at 80% and switches to cache-only serving at 100%. It is a soft limit: concurrent requests right at the limit can overshoot it slightly. Sample keys are additionally clamped to at most 5 rows per request by `fetchUnwrapped`.
