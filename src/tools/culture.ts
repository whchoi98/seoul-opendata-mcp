import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeEvents, filterEvents } from '../normalize/culture.js'
import { normalizeReservations } from '../normalize/reservation.js'
import { positionalPath } from './path.js'

// 공공서비스예약은 분야별 서비스 5개로 나뉜다(합계가 종합 서비스 tvYeyakCOllect와 같다). 1번 자리는 소분류(MINCLASSNM, 부분일치)
const RESERVATION_SERVICE = {
  culture: 'ListPublicReservationCulture',
  sports: 'ListPublicReservationSport',
  facility: 'ListPublicReservationInstitution',
  education: 'ListPublicReservationEducation',
  medical: 'ListPublicReservationMedical',
} as const

export function registerCultureTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_cultural_events',
    {
      title: 'Search Seoul cultural events',
      description:
        'Search Seoul cultural events (concerts, exhibitions, festivals) by keyword/category/district/date-range/free-only. ' +
        '서울시 문화행사 검색. "이번 주말 마포구 무료 공연 있어?" 류 질문에 사용.',
      inputSchema: {
        keyword: z.string().optional().describe('행사명 키워드 (API TITLE 검색)'),
        category: z.string().optional().describe('분류 (예: 콘서트, 전시/미술, 축제-문화/예술)'),
        district: z.string().optional().describe('자치구 (예: 마포구)'),
        from: z.string().optional().describe('기간 시작 YYYY-MM-DD'),
        to: z.string().optional().describe('기간 끝 YYYY-MM-DD'),
        freeOnly: z.boolean().optional().describe('무료만'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 15)'),
      },
    },
    async ({ keyword, category, district, from, to, freeOnly, limit }) => {
      // 경로 파라미터: /{CODENAME}/{TITLE}/{DATE} — 생략은 공백 한 칸
      const path = [category ?? ' ', keyword ?? ' ', ' ']
      const u = await ctx.client.getJson('culturalEventInfo', 1, 500, path)
      const events = filterEvents(normalizeEvents(u.rows), { district, from, to, freeOnly })
      return ok(
        { count: events.length, events: events.slice(0, limit ?? 15) },
        {
          source: 'OA-15486 (culturalEventInfo)',
          notes: [
            '서버에서 category/keyword로 1차 검색 후 최대 500건 내에서 자치구·기간·무료 필터를 적용했습니다.',
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
  server.registerTool(
    'search_public_reservations',
    {
      title: 'Search Seoul public service reservations',
      description:
        'Search reservable Seoul public services (sports facilities, cultural/kids programs, rooms and camping, classes, clinics) with status, fee, and booking URL. ' +
        '서울시 공공서비스예약(yeyak.seoul.go.kr) 검색. "송파구 테니스장 예약", "주말 아이랑 갈 무료 체험" 류 질문에 사용.',
      inputSchema: {
        category: z.enum(['culture', 'sports', 'facility', 'education', 'medical']).describe(
          '분야: culture(교육체험, 산림여가, 서울형키즈카페, 공원탐방, 전시/관람), sports(테니스장, 풋살장, 축구장, 파크골프장 등), ' +
          'facility(강의실, 다목적실, 회의실, 캠핑장, 공연장 등 공간 대관), education(교육강좌), medical(진료복지)'),
        subcategory: z.string().optional().describe('소분류 키워드, 서버에서 부분일치 (예: "테니스장", "서울형키즈카페", "캠핑장", "교육체험")'),
        district: z.string().optional().describe('자치구 (예: "송파구")'),
        keyword: z.string().optional().describe('서비스명 또는 장소명 키워드'),
        target: z.string().optional().describe('이용 대상 키워드 (예: "어린이", "가족", "성인")'),
        freeOnly: z.boolean().optional().describe('무료만 (기본 false)'),
        openOnly: z.boolean().optional().describe('접수중인 것만 (기본 false)'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ category, subcategory, district, keyword, target, freeOnly, openOnly, limit }) => {
      const service = RESERVATION_SERVICE[category]
      const { rows, note } = await ctx.client.fetchAll(service, { max: 1000, pageSize: 1000, path: positionalPath([subcategory]) })
      let list = normalizeReservations(rows)
      if (district) { const d = district.trim().replace(/구$/, ''); list = list.filter(r => r.district.includes(d)) }
      if (keyword) list = list.filter(r => r.name.includes(keyword) || r.place.includes(keyword))
      if (target) list = list.filter(r => r.target.includes(target))
      if (freeOnly) list = list.filter(r => r.payment === '무료')
      if (openOnly) list = list.filter(r => r.status === '접수중')
      return ok(
        { category, count: list.length, reservations: list.slice(0, limit ?? 10) },
        {
          source: `서울시 공공서비스예약 (${service})`,
          notes: [
            '서울시 공공서비스예약(yeyak.seoul.go.kr)에 등록된 서비스만 나옵니다. 신청과 예약은 url에서 하고, 접수 상태(status)는 수시로 바뀝니다.',
            ...(note ? [note] : []),
            ...(list.length === 0 && rows.length > 0 ? ['조건에 맞는 예약 서비스가 없습니다. 조건을 줄이거나 subcategory를 바꿔 보세요.'] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
