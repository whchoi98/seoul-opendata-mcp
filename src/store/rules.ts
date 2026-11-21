/**
 * 저장소가 답할 수 있는 요청의 허용 목록 (스펙 §4). 표에 없는 서비스와 자리는 저장소를 지나
 * 지금 경로(캐시와 서울 API)로 간다. 규칙이 모자라면 호출이 한 번 더 나갈 뿐 틀린 답은 나가지 않는다.
 */

/** 경로 자리 하나의 규칙. field는 행의 필드 이름이자 카탈로그 pathParams의 name이다 */
export type SlotRule =
  | { field: string; kind: 'eq' | 'contains' }
  /** decide: 문서만으로 의미를 알 수 없어 verify로 정할 자리 (스펙 §7.2) */
  | { field: string; kind: 'unsupported'; decide?: boolean }
  | { field: string; kind: 'partition'; pattern: RegExp }

/** 수집기가 파티션 값을 만드는 방법 */
export type PartitionPlan =
  | { kind: 'date'; count: number } // 어제(KST)부터 거꾸로, 공개된 날짜 count개
  | { kind: 'month'; count: number } // 지난달부터 거꾸로 count개
  | { kind: 'lineDirDay' } // 1~9호선 x 방향 2 x 요일 3
  | { kind: 'stationDayDir' } // 역 코드 스냅샷의 1~9호선 역 x 요일 3 x 방향 2

export interface StoreRule {
  slots: SlotRule[]
  /** daily는 매일, static은 시간표 개정 때만 수집한다 */
  bundle: 'daily' | 'static'
  /** 스냅샷 하나에 저장하는 범위. full은 끝 페이지까지, head는 첫 1,000행 */
  scope: 'full' | 'head'
  /** 기한(ms). 지난 날짜의 통계처럼 바뀌지 않으면 null (스펙 §6.3) */
  maxAgeMs: number | null
  /** 스냅샷 하나를 받는 데 드는 호출 수 (2026-11-21 기준, 스펙 §2.2) */
  callsPerSnapshot: number
  partitions?: PartitionPlan
  /** verify가 쓰는 자리별 예시 값. 카탈로그에 자리가 없는 서비스만 적는다 */
  examples?: string[]
}

const DAY = 86_400_000
const eq = (field: string): SlotRule => ({ field, kind: 'eq' })
const contains = (field: string): SlotRule => ({ field, kind: 'contains' })
const unsupported = (field: string): SlotRule => ({ field, kind: 'unsupported' })
const undecided = (field: string): SlotRule => ({ field, kind: 'unsupported', decide: true })
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

export const STORE_RULES: Record<string, StoreRule> = {
  // ── 매일 묶음, 전체 12종 ──
  TbPharmacyOperateInfo: full([contains('DUTYADDR'), contains('DUTYNAME')], 7, 6),
  GetParkInfo: full([contains('ADDR'), eq('PKLT_CD'), eq('PRK_NOW_INFO_PVSN_YN')], 7, 3),
  culturalEventInfo: {
    ...full([undecided('CODENAME'), contains('TITLE'), unsupported('DATE')], 3, 20),
    examples: ['콘서트', '서울', '2026-12-24'],
  },
  SearchInfoBySubwayNameService: full([eq('STATION_NM')], 7, 1),
  ListPublicReservationCulture: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationSport: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationInstitution: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationEducation: full(
    [contains('MINCLASSNM'), contains('SVCNM'), undecided('USETGTINFO'), undecided('AREANM')], 1, 1),
  ListPublicReservationMedical: full([contains('MINCLASSNM')], 1, 1),
  tnFcltySttusInfo1011: full([contains('FCLTY_NM')], 7, 1),
  ListPriceModelStoreService: full([eq('INDUTY_CODE_SE')], 7, 2),
  OdsnBuildingInfo: full([undecided('SISUL_NM')], 7, 4),

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
}
