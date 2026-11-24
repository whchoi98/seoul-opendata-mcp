import { num } from './util.js'

export const SEOUL_DISTRICTS = [
  '종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구',
  '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구',
  '관악구', '서초구', '강남구', '송파구', '강동구',
] as const

/** "강남", "서울 강남구" 같은 입력을 API가 요구하는 전체 자치구명으로 맞춘다. 서울 자치구가 아니면 null */
export function normalizeDistrict(input: string): string | null {
  const t = input.trim().replace(/^서울(특별시|시)?\s*/, '')
  if (!t) return null
  const full = t.endsWith('구') ? t : `${t}구`
  return (SEOUL_DISTRICTS as readonly string[]).includes(full) ? full : null
}

export interface RealEstateDeal {
  year: string; district: string; dong: string; building: string
  amount: number | null; area: number | null; landArea: number | null; floor: number | null
  contractDate: string; use: string; buildYear: string
  dealMethod: string; rightType: string; cancelDate: string
}

/** 건축연도. 분양권과 입주권처럼 건물이 아직 없는 거래는 원본이 0이다. 연도가 아니므로 빈 값으로 둔다 */
function buildYearOf(value: unknown): string {
  const year = String(value ?? '')
  return year === '0' ? '' : year
}

export function normalizeRealEstate(rows: any[]): RealEstateDeal[] {
  return rows.map(r => ({
    year: String(r.RCPT_YR ?? ''),
    district: r.CGG_NM ?? '',
    dong: r.STDG_NM ?? '',
    building: r.BLDG_NM ?? '',
    amount: num(r.THING_AMT),          // 물건금액(만원)
    area: num(r.ARCH_AREA),            // 건물면적(㎡)
    landArea: num(r.LAND_AREA),        // 토지면적(㎡)
    floor: num(r.FLR),
    contractDate: String(r.CTRT_DAY ?? ''),
    use: r.BLDG_USG ?? '',
    buildYear: buildYearOf(r.ARCH_YR),
    dealMethod: r.DCLR_SE ?? '',       // 중개거래 | 직거래
    rightType: r.RGHT_SE ?? '',        // 입주권 등, 일반 매매는 빈 문자열
    cancelDate: String(r.RTRCN_DAY ?? ''), // 값이 있으면 해제된 거래
  }))
}

export interface RentDeal {
  year: string; district: string; dong: string; building: string
  rentType: string; deposit: number | null; monthlyRent: number | null
  area: number | null; floor: number | null
  contractDate: string; contractPeriod: string; use: string; buildYear: string
  contractType: string; renewalRightUsed: boolean
  prevDeposit: number | null; prevMonthlyRent: number | null
}
export function normalizeRentDeal(rows: any[]): RentDeal[] {
  return rows.map(r => ({
    year: String(r.RCPT_YR ?? ''),
    district: r.CGG_NM ?? '',
    dong: r.STDG_NM ?? '',
    building: r.BLDG_NM ?? '',
    rentType: r.RENT_SE ?? '',         // 전세 | 월세
    deposit: num(r.GRFE),              // 보증금(만원)
    monthlyRent: num(r.RTFE),          // 월세(만원)
    area: num(r.RENT_AREA),            // 임대면적(㎡)
    floor: num(r.FLR),
    contractDate: String(r.CTRT_DAY ?? ''),
    contractPeriod: r.CTRT_PRD ?? '',  // 예: 26.12~28.12
    use: r.BLDG_USG ?? '',
    buildYear: buildYearOf(r.ARCH_YR),
    contractType: r.NEW_UPDT_YN ?? '', // 신규 | 갱신
    renewalRightUsed: String(r.CTRT_UPDT_USE_YN ?? '').trim() !== '', // 원본은 '○' 또는 빈 문자열
    prevDeposit: num(r.BFR_GRFE),      // 갱신 계약의 종전 보증금(만원)
    prevMonthlyRent: num(r.BFR_RTFE),
  }))
}

/** 본번과 부번(4자리 0 채움)을 "633-7" 꼴로. 필지구분 2는 산 */
export function formatLot(landTypeCode: unknown, main: unknown, sub: unknown): string {
  const m = num(main)
  if (m == null) return ''
  const s = num(sub)
  return `${String(landTypeCode) === '2' ? '산' : ''}${m}${s ? `-${s}` : ''}`
}

export interface LandPrice {
  year: string; district: string; dong: string; lotNumber: string; landType: string
  pricePerSqm: number | null; baseDate: string; pnu: string
}
export function normalizeLandPrice(rows: any[]): LandPrice[] {
  return rows.map(r => {
    const pnuParts = [r.SIGUNGU_CD, r.BJDONG_CD, r.PILGI_CD, r.BONBEON, r.BUBEON]
    return {
      year: String(r.YEAR ?? ''),
      district: r.SIGUNGU_NM ?? '',
      dong: r.BJDONG_NM ?? '',
      lotNumber: formatLot(r.PILGI_CD, r.BONBEON, r.BUBEON),
      landType: r.PILGI_NM ?? '',
      pricePerSqm: num(r.JIGA),        // 원/㎡
      baseDate: r.BASE_MON ?? '',      // 가격 기준일
      // 필지고유번호 19자리: 시군구5 + 법정동5 + 필지구분1 + 본번4 + 부번4
      pnu: pnuParts.every(p => p != null && p !== '') ? pnuParts.join('') : '',
    }
  })
}
