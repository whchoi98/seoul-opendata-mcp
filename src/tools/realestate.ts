import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import type { Unwrapped } from '../client/response.js'
import { ok } from './envelope.js'
import { normalizeDistrict, normalizeRealEstate, normalizeRentDeal, normalizeLandPrice } from '../normalize/realestate.js'

const SALE = 'tbLnOpendataRtmsV'
const RENT = 'tbLnOpendataRentV'
const LAND = 'IndividuallyPostedLandPriceService'

// 서울 API는 경로의 자리로 필터를 구분한다. 매매와 전월세는 뒤쪽 순서가 다르다.
// 매매:   RCPT_YR, CGG_CD, CGG_NM, STDG_CD, LOTNO_SE, LOTNO_SE_NM, MNO, SNO, BLDG_NM, CTRT_DAY, BLDG_USG
// 전월세: RCPT_YR, CGG_CD, CGG_NM, STDG_CD, LOTNO_SE, MNO, SNO, CTRT_DAY, BLDG_NM, BLDG_USG
type Slot = 'year' | 'district' | 'dongCode' | 'building' | 'use'
const SLOTS: Record<'sale' | 'rent', Record<Slot, number>> = {
  sale: { year: 0, district: 2, dongCode: 3, building: 8, use: 10 },
  rent: { year: 0, district: 2, dongCode: 3, building: 8, use: 9 },
}
const BLANK = ' ' // 건너뛰는 자리. 빈 문자열을 넣으면 필터 전체가 무시된다

/** 지정된 값만 제자리에 두고 사이를 공백으로 채운다. 뒤쪽 빈 자리는 보내지 않는다 */
function buildPath(slots: Record<Slot, number>, values: Partial<Record<Slot, string>>): string[] {
  const path: string[] = []
  for (const [slot, value] of Object.entries(values) as [Slot, string | undefined][]) {
    const v = value?.trim()
    if (!v) continue
    while (path.length < slots[slot]) path.push(BLANK)
    path[slots[slot]] = v
  }
  return path
}

const DEFAULT_WINDOW = 100 // limit(최대 50)과 해제 거래 제외분을 덮는 한 번 호출 크기
const FILTER_WINDOW = 500  // 서버가 못 거르는 조건을 코드에서 거를 때 보는 최신 건수

const kstYear = () => new Date(Date.now() + 9 * 3_600_000).getUTCFullYear()

/** 조건에 맞는 행이 없다는 정상 응답인지. 쿼터 소진처럼 다른 이유로 비어 있으면 false */
const isNoData = (u: Unwrapped) => u.rows.length === 0 && (!u.note || u.note.startsWith('해당하는 데이터가 없습니다'))

type DongLookup =
  | { kind: 'found'; code: string; name: string }
  | { kind: 'notFound' }
  | { kind: 'unavailable'; reason: string }

/** 실거래가 API는 법정동을 코드로만 거른다. 공시지가 서비스가 이름으로 같은 코드를 돌려주므로 1행 조회로 얻는다 */
async function lookupDongCode(ctx: Ctx, district: string, dong: string): Promise<DongLookup> {
  const names = [dong]
  const legal = dong.replace(/\d+동$/, '동') // 행정동(역삼1동)을 법정동(역삼동)으로
  if (legal !== dong) names.push(legal)
  try {
    for (const name of names) {
      const u = await ctx.client.getJson(LAND, 1, 1, [district, name, BLANK, BLANK, BLANK, String(kstYear() - 1)])
      const row = u.rows[0]
      if (row?.BJDONG_CD) return { kind: 'found', code: String(row.BJDONG_CD), name: row.BJDONG_NM ?? name }
      if (!isNoData(u)) return { kind: 'unavailable', reason: u.note ?? '응답에 법정동 코드가 없습니다' }
    }
    return { kind: 'notFound' }
  } catch (e) {
    return { kind: 'unavailable', reason: (e as Error).message }
  }
}

export function registerRealEstateTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_real_estate_prices',
    {
      title: 'Real estate sale and rent transactions',
      description:
        'Get Seoul real-estate transaction records, sales or rentals (amounts in 만원), filtered by year, district, legal dong, building name and building type. ' +
        '부동산 매매 및 전월세 실거래가. "2025년 강남구 아파트 실거래가?", "타워팰리스 전세 보증금?" 류 질문에 사용.',
      inputSchema: {
        dealType: z.enum(['sale', 'rent']).optional().describe('거래 유형: sale=매매(기본), rent=전월세'),
        district: z.string().optional().describe('자치구명 (예: "강남구", "강남")'),
        dong: z.string().optional().describe('법정동명 (예: "역삼동"). district와 함께 지정하면 서버에서 거릅니다'),
        building: z.string().optional().describe('건물명 부분일치 (예: "래미안", "타워팰리스")'),
        buildingUse: z.enum(['아파트', '연립다세대', '단독다가구', '오피스텔']).optional().describe('건물 용도'),
        year: z.string().regex(/^\d{4}$/).optional().describe('접수연도 YYYY (생략하면 전체 연도에서 최신순)'),
        rentType: z.enum(['전세', '월세']).optional().describe(`전월세 구분 (dealType=rent 전용, 최신 ${FILTER_WINDOW}건 안에서 거름)`),
        includeCancelled: z.boolean().optional().describe('해제된 매매 거래 포함 여부 (기본 false)'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ dealType, district, dong, building, buildingUse, year, rentType, includeCancelled, limit }) => {
      const deal = dealType ?? 'sale'
      const service = deal === 'sale' ? SALE : RENT
      const source = deal === 'sale' ? `부동산 실거래가 (${SALE})` : `부동산 전월세가 (${RENT})`
      const empty = (note: string) =>
        ok({ dealType: deal, totalCount: 0, count: 0, deals: [] }, { source, notes: [note], sample: ctx.client.isSample })
      const notes: string[] = []

      let districtName: string | undefined
      if (district) {
        districtName = normalizeDistrict(district) ?? undefined
        if (!districtName) return empty(`'${district}'은(는) 서울 자치구 이름이 아닙니다. 예: "강남구", "마포구"`)
      }

      let dongCode: string | undefined
      let dongName = dong?.trim() || undefined
      let dongByName = false // 코드를 못 얻어 받은 행에서 이름으로 거르는 경우
      if (dongName && districtName) {
        const found = await lookupDongCode(ctx, districtName, dongName)
        if (found.kind === 'notFound') {
          return empty(`${districtName}에서 '${dongName}' 법정동을 찾지 못했습니다. 행정동(역삼1동)이 아닌 법정동 이름(역삼동, 필동3가)으로 지정하세요.`)
        }
        if (found.kind === 'found') {
          if (found.name !== dongName) notes.push(`dong '${dongName}'을(를) 법정동 '${found.name}'(으)로 조회했습니다.`)
          dongCode = found.code
          dongName = found.name
        } else {
          dongByName = true
          notes.push(`법정동 코드를 조회하지 못해(${found.reason}) 최신 ${FILTER_WINDOW}건 안에서 dong을 거릅니다.`)
        }
      } else if (dongName) {
        dongByName = true
        notes.push(`district 없이 dong만 지정하면 최신 ${FILTER_WINDOW}건 안에서 거릅니다. district를 함께 지정하면 서버에서 거릅니다.`)
      }

      const wantRentType = deal === 'rent' ? rentType : undefined
      if (deal === 'sale' && rentType) notes.push('rentType은 dealType=rent일 때만 적용됩니다.')
      const window = dongByName || wantRentType ? FILTER_WINDOW : DEFAULT_WINDOW

      const path = buildPath(SLOTS[deal], { year, district: districtName, dongCode, building, use: buildingUse })
      const u = await ctx.client.getJson(service, 1, window, path)
      const n = limit ?? 10

      let deals: Array<{ dong: string }>
      if (deal === 'sale') {
        let rows = normalizeRealEstate(u.rows)
        if (dongByName) rows = rows.filter(r => r.dong.includes(dongName!))
        if (!includeCancelled) {
          const before = rows.length
          rows = rows.filter(r => !r.cancelDate)
          if (rows.length < before) notes.push(`받은 ${before}건 중 해제된 거래 ${before - rows.length}건을 뺐습니다(includeCancelled=true로 포함).`)
        }
        deals = rows
        notes.unshift('amount 단위: 만원. deals는 계약일 최신순입니다.')
      } else {
        let rows = normalizeRentDeal(u.rows)
        if (dongByName) rows = rows.filter(r => r.dong.includes(dongName!))
        if (wantRentType) rows = rows.filter(r => r.rentType === wantRentType)
        deals = rows
        notes.unshift('deposit(보증금)과 monthlyRent(월세) 단위: 만원. deals는 계약일 최신순입니다.')
      }

      notes.push('totalCount는 서버에서 거른 조건(연도, 자치구, 법정동, 건물명, 용도)에 맞는 전체 건수입니다.')
      if (wantRentType && u.totalCount > window) notes.push(`rentType은 최신 ${window}건 안에서 거른 결과입니다.`)
      if (u.note) notes.push(u.note)

      return ok(
        {
          dealType: deal,
          ...(districtName ? { district: districtName } : {}),
          ...(dongName ? { dong: dongName } : {}),
          ...(year ? { year } : {}),
          totalCount: u.totalCount, count: Math.min(deals.length, n), deals: deals.slice(0, n),
        },
        { source, notes, sample: ctx.client.isSample },
      )
    },
  )

  server.registerTool(
    'get_land_price',
    {
      title: 'Officially assessed individual land price',
      description:
        'Get the officially assessed individual land price (KRW per square meter) for parcels in a Seoul district, optionally narrowed to a legal dong and lot number. ' +
        '개별공시지가(원/㎡) 조회. "역삼동 737번지 공시지가?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().describe('자치구명 (예: "강남구", "강남")'),
        dong: z.string().optional().describe('법정동명 (예: "역삼동")'),
        lotNumber: z.string().regex(/^\d{1,4}(-\d{1,4})?$/).optional().describe('지번 "본번" 또는 "본번-부번" (예: "737", "633-7"). dong과 함께 사용'),
        year: z.string().regex(/^\d{4}$/).optional().describe('기준연도 YYYY (생략하면 올해, 아직 공시 전이면 작년)'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ district, dong, lotNumber, year, limit }) => {
      const source = `개별공시지가 (${LAND})`
      const empty = (note: string) =>
        ok({ totalCount: 0, count: 0, parcels: [] }, { source, notes: [note], sample: ctx.client.isSample })

      const districtName = normalizeDistrict(district)
      if (!districtName) return empty(`'${district}'은(는) 서울 자치구 이름이 아닙니다. 예: "강남구", "마포구"`)
      const dongName = dong?.trim() || undefined
      if (lotNumber && !dongName) return empty('lotNumber는 dong과 함께 지정해야 합니다(지번은 법정동 안에서만 유일합니다).')

      const n = limit ?? 10
      const [main, sub] = lotNumber?.split('-') ?? []
      const fetchYear = (y: number) =>
        ctx.client.getJson(LAND, 1, n, [districtName, dongName ?? BLANK, main ?? BLANK, sub ?? BLANK, BLANK, String(y)])

      const notes = ['pricePerSqm 단위: 원/㎡. baseDate는 가격 기준일입니다.']
      let y = year ? Number(year) : kstYear()
      let u = await fetchYear(y)
      if (!year && isNoData(u)) {
        const prev = await fetchYear(y - 1)
        if (prev.rows.length > 0) {
          notes.push(`${y}년 공시 자료가 아직 없어 ${y - 1}년 자료로 답합니다.`)
          y -= 1
          u = prev
        }
      }

      const parcels = normalizeLandPrice(u.rows).slice(0, n)
      if (u.totalCount > parcels.length) {
        notes.push(`조건에 맞는 필지 ${u.totalCount}건 중 ${parcels.length}건입니다. dong과 lotNumber로 좁히세요. 순서는 가격순이 아닙니다.`)
      }
      if (u.note) notes.push(u.note)

      return ok(
        {
          district: districtName, ...(dongName ? { dong: dongName } : {}), year: String(y),
          totalCount: u.totalCount, count: parcels.length, parcels,
        },
        { source, notes, sample: ctx.client.isSample },
      )
    },
  )
}
