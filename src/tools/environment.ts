import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { extractWeather } from '../normalize/citydata.js'
import { normalizeAir, PM10_LIMITS, PM25_LIMITS } from '../normalize/air.js'

const limits = (values: readonly number[]) => values.join(', ')
/** grade를 미세먼지 등급으로 읽는 일을 막는다. 구간은 normalize/air.ts의 상수에서 가져와 문구와 계산이 어긋나지 않게 한다 */
const GRADE_NOTE =
  'grade와 index는 통합대기환경지수이고 mainPollutant가 그 값을 정한 물질입니다. 미세먼지 등급은 pm10Grade, pm25Grade를 쓰세요. ' +
  `환경부 예보 등급 구간으로 계산했습니다: PM10은 ${limits(PM10_LIMITS)}, PM2.5는 ${limits(PM25_LIMITS)} ㎍/㎥ 이하가 차례로 좋음, 보통, 나쁨이고 그 위는 매우나쁨입니다.`

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
      return ok({ place: r.name, ...data }, {
        source: 'OA-21285 (citydata WEATHER_STTS, 기상청 연계)',
        asOf: data.measuredAt || null,
        notes: [...(u.note ? [u.note] : [])],
        sample: ctx.client.isSample,
      })
    },
  )

  server.registerTool(
    'get_air_quality',
    {
      title: 'Real-time air quality by district',
      description:
        'Get real-time air quality for Seoul districts: PM10/PM2.5 values with their own grades, plus the composite air index grade; omit district to get all 25. ' +
        'For one hotspot use get_weather, which returns PM10/PM2.5 levels at that place. ' +
        '자치구별 실시간 대기질(미세먼지와 초미세먼지 등급, 통합대기환경지수). 특정 장소의 미세먼지는 get_weather를 씁니다. "오늘 강남구 미세먼지 어때?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().optional().describe('자치구명 (예: "강남구") — 생략 시 25개 전체'),
      },
    },
    async ({ district }) => {
      const u = await ctx.client.getJson('RealtimeCityAir', 1, 25)
      let rows = normalizeAir(u.rows)
      if (district) rows = rows.filter(a => a.district.includes(district.replace(/구$/, '')) || a.district === district)
      const unmeasured = rows.filter(a => a.pm10 === null && a.pm25 === null).map(a => a.district)
      return ok(
        { count: rows.length, airQuality: rows },
        {
          source: '서울시 권역별 실시간 대기환경 (RealtimeCityAir)',
          asOf: rows[0]?.measuredAt ?? null,
          notes: [
            ...(u.note ? [u.note] : []),
            // 응답 행이 있는데 걸러서 비었을 때만 자치구명 문제로 안내한다
            ...(rows.length === 0 && u.rows.length > 0 ? ['해당 자치구를 찾지 못했습니다. "강남구"처럼 정식 자치구명을 쓰세요.'] : []),
            ...(rows.length > 0 ? [GRADE_NOTE] : []),
            ...(unmeasured.length > 0 ? [`미세먼지 측정값이 없는 자치구: ${unmeasured.join(', ')}. 원본이 0과 빈 등급이라 null로 표시했습니다.`] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
