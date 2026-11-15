#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SeoulApiClient } from './client/seoulApi.js'
import { loadDotEnv } from './client/env.js'
import type { Ctx } from './tools/context.js'
import { registerCommonTools } from './tools/common.js'
import { registerPopulationTools } from './tools/population.js'
import { registerTrafficTools } from './tools/traffic.js'
import { registerCultureTools } from './tools/culture.js'
import { registerEnvironmentTools } from './tools/environment.js'
import { registerStatsTools } from './tools/stats.js'
import { registerRealEstateTools } from './tools/realestate.js'
import { registerHealthTools } from './tools/health.js'
import { registerMetaTools } from './tools/meta.js'

export const SERVER_NAME = 'seoul-opendata-mcp'
export const SERVER_VERSION = '0.5.0'

export const TOOL_NAMES = [
  'search_place', 'get_city_snapshot', 'get_disaster_alerts',
  'get_population', 'get_commercial_activity',
  'get_subway_arrivals', 'get_bike_stations', 'get_parking', 'get_road_traffic',
  'search_cultural_events',
  'get_air_quality', 'get_weather',
  'get_subway_ridership', 'get_living_population', 'get_real_estate_prices', 'get_land_price', 'find_pharmacies',
  'search_dataset', 'get_dataset_spec', 'call_dataset',
] as const

export function buildServer(client: SeoulApiClient = new SeoulApiClient()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const ctx: Ctx = { client }
  registerCommonTools(server, ctx)
  registerPopulationTools(server, ctx)
  registerTrafficTools(server, ctx)
  registerCultureTools(server, ctx)
  registerStatsTools(server, ctx)
  registerRealEstateTools(server, ctx)
  registerEnvironmentTools(server, ctx)
  registerHealthTools(server, ctx)
  registerMetaTools(server, ctx)
  return server
}

// CLI 실행 시에만 stdio 연결 (테스트 import 시에는 연결 안 함)
// realpath 비교: npm/npx가 만드는 bin 심볼릭 링크(예: seoul-opendata-mcp -> dist/index.js)로
// 실행되면 process.argv[1]이 index.js로 끝나지 않으므로, 파일명 접미사 비교 대신
// 실제 경로(symlink 해석 후)를 이 모듈의 경로와 비교한다.
const isCli = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()
if (isCli) {
  loadDotEnv()
  const client = new SeoulApiClient()
  if (client.isSample) {
    console.error(`[${SERVER_NAME}] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다 (제한: citydata 계열은 광화문·덕수궁만).`)
  }
  const { maybeAttachL2 } = await import('./client/dynamo.js')
  await maybeAttachL2(client)
  await buildServer(client).connect(new StdioServerTransport())
}
