/**
 * 저장소가 답할 수 있는 요청의 허용 목록 (스펙 §4). 표에 없는 서비스와 자리는 저장소를 지나
 * 지금 경로(캐시와 서울 API)로 간다. 규칙이 모자라면 호출이 한 번 더 나갈 뿐 틀린 답은 나가지 않는다.
 */

/** 경로 자리 하나의 규칙. field는 행의 필드 이름이자 카탈로그 pathParams의 name이다 */
export type SlotRule =
  | { field: string; kind: 'eq' | 'contains' }
  /** 지번처럼 0을 채운 4자리로 저장된 숫자. 요청 값 "737"은 행의 "0737"과 일치한다 */
  | { field: string; kind: 'pad4' }
  /** decide: 문서만으로 의미를 알 수 없어 verify로 정할 자리 (스펙 §7.2) */
  | { field: string; kind: 'unsupported'; decide?: boolean }
  | { field: string; kind: 'partition'; pattern: RegExp }

/** 수집기가 파티션 값을 만드는 방법 */
export type PartitionPlan =
  | { kind: 'date'; count: number } // 어제(KST)부터 거꾸로, 공개된 날짜 count개
  | { kind: 'month'; count: number } // 지난달부터 거꾸로 count개
  | { kind: 'lineDirDay' } // 1~9호선 x 방향 2 x 요일 3
  | { kind: 'stationDayDir' } // 역 코드 스냅샷의 1~9호선 역 x 요일 3 x 방향 2
  | { kind: 'yearDistrict'; years: number } // 올해(KST)부터 거꾸로 years개 연도 x 자치구 25
  | { kind: 'districtYear'; years: number } // 자치구 25 x 연도. 자리 순서만 다르다

/** daily는 매일, static은 시간표 개정 때만, realestate는 진행자가 필요할 때 손으로 수집한다 */
export type Bundle = 'daily' | 'static' | 'realestate'

export interface StoreRule {
  slots: SlotRule[]
  bundle: Bundle
  /** 스냅샷 하나에 저장하는 범위. full은 끝 페이지까지, head는 첫 1,000행 */
  scope: 'full' | 'head'
  /** 기한(ms). 지난 날짜의 통계처럼 바뀌지 않으면 null (스펙 §6.3) */
  maxAgeMs: number | null
  /** 스냅샷 하나를 받는 데 드는 호출 수 (2026-11-21 기준, 스펙 §2.2) */
  callsPerSnapshot: number
  partitions?: PartitionPlan
  /** 이 시간 안에 받은 스냅샷은 수집기가 건너뛴다. 없으면 묶음의 기본값(매일 1시간, 그 밖 7일) */
  skipMs?: number
  /**
   * 서울 API가 이 필드의 내림차순으로 행을 준다. 값이 같은 행끼리의 순서는 정해져 있지 않아 verify가 그 차이를 실패로 보지 않는다.
   * unstable이면 그 순서가 요청마다 달라 페이지 경계에서 행이 겹치거나 빠진다. 수집기가 경계에 걸친 값의 행을 그 값으로 다시 받아 맞춘다.
   * field는 일치로 걸러지는 경로 자리여야 한다
   */
  order?: { field: string; unstable?: boolean }
  /** verify가 쓰는 자리별 예시 값. 카탈로그에 자리가 없는 서비스만 적는다 */
  examples?: string[]
}

const DAY = 86_400_000
const eq = (field: string): SlotRule => ({ field, kind: 'eq' })
const contains = (field: string): SlotRule => ({ field, kind: 'contains' })
const unsupported = (field: string): SlotRule => ({ field, kind: 'unsupported' })
const undecided = (field: string): SlotRule => ({ field, kind: 'unsupported', decide: true })
const pad4 = (field: string): SlotRule => ({ field, kind: 'pad4' })
const partition = (field: string, pattern: RegExp): SlotRule => ({ field, kind: 'partition', pattern })

const full = (slots: SlotRule[], maxAgeDays: number, calls: number): StoreRule =>
  ({ slots, bundle: 'daily', scope: 'full', maxAgeMs: maxAgeDays * DAY, callsPerSnapshot: calls })
const head = (maxAgeDays = 7): StoreRule =>
  ({ slots: [], bundle: 'daily', scope: 'head', maxAgeMs: maxAgeDays * DAY, callsPerSnapshot: 1 })

// 파티션 값은 객체 키와 파일 경로가 된다. 형식에 맞는 값만 통과시킨다
const YMD = /^\d{8}$/
const YM = /^\d{6}$/
const LINE = /^[1-9]호선$/
const DIRECTION = /^[12]$/
const DAY_TYPE = /^[123]$/
const STATION_CODE = /^[0-9A-Za-z]{1,8}$/
const YEAR = /^\d{4}$/

/** 서울 자치구 25개. 부동산 3종의 파티션 값이다. src/normalize의 SEOUL_DISTRICTS와 같아야 한다(tests/store/rules.test.ts) */
export const DISTRICTS = [
  '종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구',
  '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구',
  '관악구', '서초구', '강남구', '송파구', '강동구',
] as const
const DISTRICT = new RegExp(`^(${DISTRICTS.join('|')})$`)

export const STORE_RULES: Record<string, StoreRule> = {
  // ── 매일 묶음, 전체 12종 ──
  TbPharmacyOperateInfo: full([contains('DUTYADDR'), contains('DUTYNAME')], 7, 6),
  GetParkInfo: full([contains('ADDR'), eq('PKLT_CD'), unsupported('PRK_NOW_INFO_PVSN_YN')], 7, 3),
  culturalEventInfo: {
    ...full([undecided('CODENAME'), unsupported('TITLE'), unsupported('DATE')], 3, 20),
    examples: ['콘서트', '서울', '2026-12-24'],
  },
  SearchInfoBySubwayNameService: full([eq('STATION_NM')], 7, 1),
  ListPublicReservationCulture: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationSport: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationInstitution: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationEducation: full(
    [contains('MINCLASSNM'), contains('SVCNM'), undecided('USETGTINFO'), contains('AREANM')], 1, 1),
  ListPublicReservationMedical: full([contains('MINCLASSNM')], 1, 1),
  tnFcltySttusInfo1011: full([contains('FCLTY_NM')], 7, 1),
  ListPriceModelStoreService: full([eq('INDUTY_CODE_SE')], 7, 2),
  OdsnBuildingInfo: full([contains('SISUL_NM')], 7, 4),

  // ── 매일 묶음, 머리 19종: call_dataset은 1행부터 최대 50행만 요청한다 ──
  SPOP_DAILYSUM_JACHI: head(),
  TbPublicWifiInfo: head(),
  TbGtnHwcwP: head(),
  VwsmTrdarSelngQq: head(),
  ListTraditionalMarket: head(),
  ListNecessariesPricesService: head(),
  culturalSpaceInfo: head(),
  SearchParkInfoService: head(),
  SeoulPublicLibraryInfo: head(),
  TbHospitalInfo: head(),
  ChildCareInfo: head(),
  TbGtnCwP: head(),
  tbClicomCnt: head(),
  TvEmgcHospitalInfo: head(),
  mgis1708328729039Point: head(),
  SeoulMetroFaciInfo: head(3),
  goodPrices: head(),
  mgisToiletPoi: head(),
  LOCALDATA_020301: head(),

  // ── 매일 묶음, 파티션 4종: 지난 날짜의 통계는 바뀌지 않아 기한이 없다 ──
  CardSubwayStatsNew: {
    slots: [partition('USE_YMD', YMD)],
    bundle: 'daily', scope: 'full', maxAgeMs: null, callsPerSnapshot: 1, partitions: { kind: 'date', count: 14 },
  },
  CardBusStatisticsServiceNew: {
    slots: [partition('USE_YMD', YMD)],
    bundle: 'daily', scope: 'head', maxAgeMs: null, callsPerSnapshot: 1, partitions: { kind: 'date', count: 1 },
  },
  CardSubwayTime: {
    slots: [partition('USE_MM', YM), eq('SBWY_ROUT_LN_NM'), eq('STTN')],
    bundle: 'daily', scope: 'full', maxAgeMs: null, callsPerSnapshot: 1, partitions: { kind: 'month', count: 3 },
  },
  SPOP_LOCAL_RESD_DONG: {
    slots: [partition('STDR_DE_ID', YMD), eq('TMZON_PD_SE'), eq('ADSTRD_CODE_SE')],
    bundle: 'daily', scope: 'full', maxAgeMs: null, callsPerSnapshot: 11, partitions: { kind: 'date', count: 3 },
  },

  // ── 정적 묶음, 파티션 2종: 시간표 개정 때만 바뀐다 ──
  SearchFirstAndLastTrainbyLineServiceNew: {
    slots: [partition('SBWY_ROUT_LN', LINE), partition('UPLN_DNLN', DIRECTION), partition('DOW', DAY_TYPE), eq('SUBW_CD'), eq('OTSD_CD')],
    bundle: 'static', scope: 'full', maxAgeMs: 30 * DAY, callsPerSnapshot: 1, partitions: { kind: 'lineDirDay' },
  },
  SearchSTNTimeTableByIDService: {
    slots: [partition('STATION_CD', STATION_CODE), partition('WEEK_TAG', DAY_TYPE), partition('INOUT_TAG', DIRECTION)],
    bundle: 'static', scope: 'full', maxAgeMs: 30 * DAY, callsPerSnapshot: 1, partitions: { kind: 'stationDayDir' },
  },

  // ── 부동산 묶음, 파티션 3종: 연도와 자치구가 모두 있는 요청만 답한다. 스냅샷당 호출 수는 2026-11-23 건수로 잡은 평균의 상한 ──
  // 매매: 2026년 111,959행, 2025년 135,052행. 자치구명은 3번째 자리라 파티션 자리 사이에 미지원 자리(CGG_CD)가 낀다.
  // 계약일이 같은 행의 순서가 요청마다 달라 페이지 경계의 날짜를 다시 받는다. 호출 수는 페이지 약 5회에 경계 약 4회를 더했다
  tbLnOpendataRtmsV: {
    slots: [
      partition('RCPT_YR', YEAR), unsupported('CGG_CD'), partition('CGG_NM', DISTRICT), eq('STDG_CD'),
      unsupported('LOTNO_SE'), unsupported('LOTNO_SE_NM'), unsupported('MNO'), unsupported('SNO'),
      contains('BLDG_NM'), unsupported('CTRT_DAY'), eq('BLDG_USG'),
    ],
    bundle: 'realestate', scope: 'full', maxAgeMs: 7 * DAY, callsPerSnapshot: 10,
    partitions: { kind: 'yearDistrict', years: 2 }, skipMs: DAY / 2, order: { field: 'CTRT_DAY', unstable: true },
  },
  // 전월세: 2026년 512,333행. 2025년은 1,085,056행이라 받지 않는다. 계약일 내림차순이고 같은 요청의 순서는 바뀌지 않는다
  tbLnOpendataRentV: {
    slots: [
      partition('RCPT_YR', YEAR), unsupported('CGG_CD'), partition('CGG_NM', DISTRICT), eq('STDG_CD'),
      unsupported('LOTNO_SE'), unsupported('MNO'), unsupported('SNO'), unsupported('CTRT_DAY'),
      contains('BLDG_NM'), eq('BLDG_USG'),
    ],
    bundle: 'realestate', scope: 'full', maxAgeMs: 7 * DAY, callsPerSnapshot: 22,
    partitions: { kind: 'yearDistrict', years: 1 }, skipMs: DAY / 2, order: { field: 'CTRT_DAY' },
  },
  // 개별공시지가: 서울 약 86만 필지(강남구 33,450). 연 1회 공시라 기한이 길고 7일 안에는 다시 받지 않는다
  IndividuallyPostedLandPriceService: {
    slots: [
      partition('SIGUNGU_NM', DISTRICT), contains('BJDONG_NM'), pad4('BONBEON'), pad4('BUBEON'),
      unsupported('PILGI_CD'), partition('YEAR', YEAR),
    ],
    bundle: 'realestate', scope: 'full', maxAgeMs: 30 * DAY, callsPerSnapshot: 36,
    partitions: { kind: 'districtYear', years: 1 },
  },
}
