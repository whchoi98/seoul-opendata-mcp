# Developer Onboarding

## Quick Start

### 1. Prerequisites

- [ ] Node.js **>= 18** installed (`node -v`) -- required by `package.json` `engines.node`
- [ ] Repository access granted (`git clone` the repo, or work inside an existing checkout)
- [ ] A free Seoul Open Data Plaza account for later API key issuance (not required to run the test suite or to start the server in sample mode)

### 2. Setup

Run these in order from the repository root.

```bash
# 1. Install dependencies
npm install

# 2. Build (compiles TypeScript -> dist/, per tsconfig.json)
npm run build

# 3. Run the test suite (vitest run -- unit tests against captured fixtures)
npm test
```

At this point the server already runs in **sample mode** with zero configuration -- `SeoulApiClient` falls back to a built-in `sample` key when no environment variable is set. Sample mode is intentionally limited (see `docs/architecture.md` Security Layer): `citydata`-family tools only work for 광화문·덕수궁 (Gwanghwamun/Deoksugung), and every other tool returns at most 5 rows.

To use your own data across all 121 hotspots and the full dataset catalog, configure an API key:

```bash
# 4. Copy the environment template and fill in your key(s)
cp .env.example .env
```

Get a free key at [data.seoul.go.kr](https://data.seoul.go.kr): sign in (or sign up), open the "인증키 신청" (authentication-key request) page, submit the short form, and the key is issued immediately -- no approval wait. Put it in `.env`:

```bash
# .env
SEOUL_API_KEY=your-general-key-here
# Optional -- subway realtime arrivals only; falls back to SEOUL_API_KEY when unset
SEOUL_SUBWAY_API_KEY=
```

`SEOUL_SUBWAY_API_KEY` is requested separately on the same site and is only needed if you want to isolate the subway-arrivals quota from the general quota; every other tool ignores it.

### 3. Verify

```bash
# Local dev run against src/ (no build needed, uses tsx)
npm run dev
```

```bash
# Interactively call tools via the MCP Inspector
npm run inspect
```

Register the server with a real MCP client to confirm the 19 tools are visible end to end:

```bash
claude mcp add seoul-opendata -e SEOUL_API_KEY=YOUR_KEY -- npx -y seoul-opendata-mcp
```

If `SEOUL_API_KEY` is unset when the server starts from the CLI, it prints a stderr warning identifying sample mode:

```
[seoul-opendata-mcp] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다 (제한: citydata 계열은 광화문·덕수궁만).
```

## Project Overview

- Read [`CLAUDE.md`](../CLAUDE.md) (if present) for project-specific conventions.
- Read [`docs/architecture.md`](architecture.md) for the full system design: Ingestion / Processing / Query-Presentation / Security layers, both Mermaid diagrams, and the Key Design Decisions.
- Review `docs/decisions/` for recorded architectural decisions (currently only [`docs/decisions/.template.md`](decisions/.template.md) -- see [`project-init:add-adr`](../CLAUDE.md) to create the first real ADR).
- Review `docs/reference/` for layer-by-layer implementation detail (`api.md`, `security.md`, `agent-llm.md`; see [`docs/reference/INDEX.md`](reference/INDEX.md)).

In one sentence: a stdio MCP server wraps two Seoul city-data HTTP APIs behind one HTTP client (`src/client`), normalizes eight upstream envelope shapes into stable domain types (`src/normalize`), and presents 19 MCP tools (`src/tools`) plus a 28-dataset catalog fallback to any LLM agent that speaks MCP.

## Development Workflow

- **Branch naming**: `feat/`, `fix/`, `docs/`, `refactor/`
- **Commit convention**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- **Before opening a PR**: `npm run build && npm test` must both pass locally
- **Adding a new normalized field or tool**: capture a fixture first (`scripts/capture-fixtures.ts`) rather than hand-writing a mock upstream payload -- see the "Fixtures are truth" decision in `docs/architecture.md`
- **Adding a new raw dataset**: add an entry to `src/data/catalog.ts` (`CATALOG`) rather than a new dedicated tool, unless the dataset is expected to be high-traffic enough to justify a typed tool (see the "Catalog hybrid" decision in `docs/architecture.md`)

## Key Concepts

- **Hotspot** -- one of the 121 official real-time locations Seoul publishes `citydata`-family data for (`src/data/hotspots.ts`). Most tools that take a `place` argument resolve it against this list via `resolvePlace()` / `searchPlace()`, not against arbitrary addresses.
- **Sample mode** -- the zero-config fallback described above (`SeoulApiClient.isSample`). Every tool response carries a `sample`-mode note in `notes[]` when active; do not confuse a short/limited result with a bug until you have confirmed a real key is set.
- **Envelope shapes** -- the Seoul Open Data Plaza does not return one consistent JSON/XML shape across services. `unwrap()` in `src/client/response.ts` handles 8 distinct shapes; if you add a new dataset and see a `PARSE` `SeoulApiError`, the upstream is very likely returning a 9th shape that needs a new branch there.
- **Relative, not absolute, congestion** -- `get_population` and `get_commercial_activity` intentionally return categorical levels (e.g. `여유`/`보통`/`약간 붐빔`/`붐빔`) rather than a device/footfall count, because the underlying feed is a telecom/card-payment sample, not a census. Do not present these levels to users as exact counts.
- **Catalog hybrid** -- 8 datasets have a dedicated, typed tool; the other 20 are reachable only via `search_dataset` -> `get_dataset_spec` -> `call_dataset`, which return raw (non-normalized) fields. See `docs/api-reference.md` for the full list.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Every response includes a "샘플 키 사용 중" note | `SEOUL_API_KEY` not set (or `.env` not loaded) | Confirm `.env` exists and is in the working directory the process starts from, or export the variable directly |
| `get_city_snapshot` / `get_population` / `get_weather` only work for 광화문·덕수궁 | Running in sample mode | Set a real `SEOUL_API_KEY` (see Setup step 2 above) |
| A place-based tool returns `candidates` instead of data | The `place` argument didn't exactly match one of the 121 hotspots | Call `search_place` first and reuse the returned `match.name` |
| `get_commercial_activity` returns `supported: false` | The resolved hotspot is one of the 39 places without commercial-activity coverage (parks, palaces, a few dense-population points) | Use one of the `alternatives` the response suggests |
| A `call_dataset` call returns `called: false` | Required `params` for that dataset id were missing or out of order | Call `get_dataset_spec` first and pass `params` in the exact order of `pathParams` |
| Tests fail after changing a `normalize/*.ts` mapper | The fixture in `tests/fixtures/` no longer matches the field the mapper reads | Re-run `scripts/capture-fixtures.ts` only if the upstream shape genuinely changed -- otherwise the mapper, not the fixture, is wrong |

## Resources

- [`docs/architecture.md`](architecture.md) -- layered architecture, both Mermaid diagrams, Key Design Decisions
- [`docs/api-reference.md`](api-reference.md) -- all 19 tools: input schema, output summary, example question
- [`docs/reference/INDEX.md`](reference/INDEX.md) -- implementation reference index (api / security / agent-llm layers)
- [`README.md`](../README.md) / [`README.ko.md`](../README.ko.md) -- user-facing quick start and tool list
- [Seoul Open Data Plaza](https://data.seoul.go.kr) -- upstream API key issuance and dataset documentation
- [Model Context Protocol](https://modelcontextprotocol.io) -- MCP client/server quickstart
