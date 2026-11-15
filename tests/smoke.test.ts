import { describe, it, expect } from 'vitest'
import { buildServer, SERVER_NAME, TOOL_NAMES } from '../src/index.js'

describe('server assembly', () => {
  it('20개 tool이 전부 등록된다', () => {
    expect(TOOL_NAMES).toEqual([
      'search_place', 'get_city_snapshot', 'get_disaster_alerts',
      'get_population', 'get_commercial_activity',
      'get_subway_arrivals', 'get_bike_stations', 'get_parking', 'get_road_traffic',
      'search_cultural_events',
      'get_air_quality', 'get_weather',
      'get_subway_ridership', 'get_living_population', 'get_real_estate_prices', 'get_land_price', 'find_pharmacies',
      'search_dataset', 'get_dataset_spec', 'call_dataset',
    ])
    expect(buildServer()).toBeTruthy()
    expect(SERVER_NAME).toBe('seoul-opendata-mcp')
  })
})
