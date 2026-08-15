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
