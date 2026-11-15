export type Category6 = '교통·이동' | '생활·인구' | '부동산·경제' | '문화·여가' | '보건·복지' | '안전·환경'
export interface DatasetParam { name: string; required: boolean; example: string; description: string }
export interface DatasetEntry {
  id: string; name: string; category: Category6; description: string
  responseType: 'json' | 'xml'; endpoint: 'open' | 'subway'
  pathParams: DatasetParam[]; sampleFields: string[]
  tool?: string; callable: boolean
}

const E = (e: DatasetEntry) => e

export const CATALOG: DatasetEntry[] = [
  // ── 기존 v1 데이터셋 8종 (정식 tool 보유 — search가 tool로 안내) ──
  E({ id: 'citydata', name: '실시간 도시데이터(통합)', category: '생활·인구', description: '핫스팟 종합 현황: 인구 혼잡도, 도로, 날씨, 행사, 재난. 실시간 스냅샷', responseType: 'xml', endpoint: 'open', pathParams: [{ name: 'AREA_NM', required: true, example: '광화문·덕수궁', description: '핫스팟 장소명' }], sampleFields: ['AREA_NM', 'LIVE_PPLTN_STTS', 'ROAD_TRAFFIC_STTS', 'WEATHER_STTS', 'EVENT_STTS'], tool: 'get_city_snapshot', callable: true }),
  E({ id: 'citydata_ppltn', name: '실시간 인구', category: '생활·인구', description: '핫스팟 실시간 인구, 혼잡도, 성연령 비율, 12시간 예측', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'AREA_NM', required: true, example: '강남역', description: '핫스팟 장소명' }], sampleFields: ['AREA_CONGEST_LVL', 'AREA_PPLTN_MIN', 'AREA_PPLTN_MAX', 'FCST_PPLTN'], tool: 'get_population', callable: true }),
  E({ id: 'citydata_cmrcl', name: '실시간 상권', category: '부동산·경제', description: '신한카드 실시간 결제 기반 상권 현황, 업종별 소비', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'AREA_NM', required: true, example: '성수카페거리', description: '핫스팟 장소명(82곳)' }], sampleFields: ['AREA_CMRCL_LVL', 'AREA_SH_PAYMENT_CNT', 'CMRCL_RSB'], tool: 'get_commercial_activity', callable: true }),
  E({ id: 'bikeList', name: '따릉이 실시간 대여현황', category: '교통·이동', description: '공공자전거 따릉이 대여소별 잔여 대수, 거치율, 위치', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['stationName', 'parkingBikeTotCnt', 'rackTotCnt', 'stationLatitude', 'stationLongitude'], tool: 'get_bike_stations', callable: true }),
  E({ id: 'culturalEventInfo', name: '문화행사 정보', category: '문화·여가', description: '공연, 전시, 축제, 콘서트 등 문화행사 일정과 장소, 요금', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CODENAME', 'GUNAME', 'TITLE', 'DATE', 'PLACE', 'USE_FEE'], tool: 'search_cultural_events', callable: true }),
  E({ id: 'GetParkingInfo', name: '시영주차장 실시간', category: '교통·이동', description: '공영주차장 실시간 주차 가능 면수, 요금', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['PKLT_NM', 'ADDR', 'TPKCT', 'NOW_PRK_VHCL_CNT'], tool: 'get_parking', callable: true }),
  E({ id: 'RealtimeCityAir', name: '자치구별 실시간 대기환경', category: '안전·환경', description: '미세먼지 PM10 PM2.5 오존 대기질 등급, 자치구별', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['MSRSTN_NM', 'PM', 'FPM', 'CAI_GRD'], tool: 'get_air_quality', callable: true }),
  E({ id: 'realtimeStationArrival', name: '지하철 실시간 도착', category: '교통·이동', description: '지하철역 실시간 열차 도착 정보, 호선, 행선지', responseType: 'json', endpoint: 'subway', pathParams: [{ name: 'statnNm', required: true, example: '강남', description: '역명(역 접미사 제외)' }], sampleFields: ['subwayId', 'trainLineNm', 'arvlMsg2', 'bstatnNm'], tool: 'get_subway_arrivals', callable: true }),
  // ── 승격 tool 대상 신규 4종 + 파생 1종 ──
  E({ id: 'CardSubwayStatsNew', name: '지하철 일별 승하차 인원', category: '교통·이동', description: '지하철 역별 하루 승차 하차 인원 통계, 이용객 수', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'USE_YMD', required: true, example: '20260801', description: '사용일자 YYYYMMDD (보통 2~4일 전까지 제공)' }], sampleFields: ['USE_YMD', 'SBWY_ROUT_LN_NM', 'SBWY_STNS_NM', 'GTON_TNOPE', 'GTOFF_TNOPE'], tool: 'get_subway_ridership', callable: true }),
  E({ id: 'SPOP_LOCAL_RESD_DONG', name: '생활인구(행정동, 내국인)', category: '생활·인구', description: '행정동별 시간대별 생활인구 추계, 상주 유동 인구 통계', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'STDR_DE_ID', required: false, example: '20260810', description: '기준일자 YYYYMMDD' }, { name: 'TMZON_PD_SE', required: false, example: '14', description: '시간대 00~23' }, { name: 'ADSTRD_CODE_SE', required: false, example: '11680640', description: '행정동코드' }], sampleFields: ['STDR_DE_ID', 'TMZON_PD_SE', 'ADSTRD_CODE_SE', 'TOT_LVPOP_CO'], tool: 'get_living_population', callable: true }),
  E({ id: 'tbLnOpendataRtmsV', name: '부동산 실거래가', category: '부동산·경제', description: '아파트 주택 부동산 매매 실거래가, 거래 금액, 면적', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'RCPT_YR', required: false, example: '2025', description: '접수연도 YYYY' }, { name: 'CGG_CD', required: false, example: '11680', description: '자치구코드 5자리' }, { name: 'CGG_NM', required: false, example: '강남구', description: '자치구명 전체(강남구)' }, { name: 'STDG_CD', required: false, example: '10100', description: '법정동코드 5자리' }, { name: 'LOTNO_SE', required: false, example: '1', description: '지번구분 코드' }, { name: 'LOTNO_SE_NM', required: false, example: '대지', description: '지번구분명' }, { name: 'MNO', required: false, example: '0737', description: '본번 4자리' }, { name: 'SNO', required: false, example: '0000', description: '부번 4자리' }, { name: 'BLDG_NM', required: false, example: '래미안', description: '건물명(부분일치)' }, { name: 'CTRT_DAY', required: false, example: '20250301', description: '계약일 YYYYMMDD' }, { name: 'BLDG_USG', required: false, example: '아파트', description: '건물용도: 아파트, 연립다세대, 단독다가구, 오피스텔' }], sampleFields: ['RCPT_YR', 'CGG_NM', 'STDG_NM', 'BLDG_NM', 'THING_AMT', 'ARCH_AREA', 'CTRT_DAY', 'RTRCN_DAY'], tool: 'get_real_estate_prices', callable: true }),
  E({ id: 'IndividuallyPostedLandPriceService', name: '개별공시지가', category: '부동산·경제', description: '토지 필지별 개별공시지가, 땅값, 제곱미터당 가격', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'SIGUNGU_NM', required: true, example: '강남구', description: '자치구명' }, { name: 'BJDONG_NM', required: false, example: '역삼동', description: '법정동명' }, { name: 'BONBEON', required: false, example: '737', description: '본번' }, { name: 'BUBEON', required: false, example: '0', description: '부번' }, { name: 'PILGI_CD', required: false, example: '1', description: '필지구분 코드' }, { name: 'YEAR', required: true, example: '2025', description: '기준연도 YYYY' }], sampleFields: ['SIGUNGU_NM', 'BJDONG_NM', 'BONBEON', 'BUBEON', 'JIGA', 'BASE_MON'], tool: 'get_land_price', callable: true }),
  E({ id: 'TbPharmacyOperateInfo', name: '약국 운영정보', category: '보건·복지', description: '약국 위치, 전화번호, 요일별 운영시간', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['DUTYNAME', 'DUTYADDR', 'DUTYTEL1', 'DUTYTIME1S', 'DUTYTIME1C'], tool: 'find_pharmacies', callable: true }),
  E({ id: 'LIVE_DST_MESSAGE', name: '긴급재난문자', category: '안전·환경', description: '재난 안전 긴급 문자 발송 내역 (핫스팟 기준)', responseType: 'xml', endpoint: 'open', pathParams: [], sampleFields: ['DST_SE_NM', 'DST_MSG_CN'], tool: 'get_disaster_alerts', callable: false }),
  // ── 카탈로그 전용 신규 15종 (call_dataset으로 호출) ──
  E({ id: 'CardBusStatisticsServiceNew', name: '버스 노선별 승하차 인원', category: '교통·이동', description: '버스 노선별 하루 승차 하차 인원 통계', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'USE_YMD', required: true, example: '20260801', description: '사용일자 YYYYMMDD' }], sampleFields: ['USE_YMD', 'RTE_ID', 'RTE_NO', 'RTE_NM'], callable: true }),
  E({ id: 'AccInfo', name: '실시간 돌발상황(TOPIS)', category: '교통·이동', description: '도로 교통사고, 공사, 집회, 통제 등 실시간 돌발 정보', responseType: 'xml', endpoint: 'open', pathParams: [], sampleFields: ['acc_id', 'occr_date', 'acc_type', 'acc_info'], callable: true }),
  E({ id: 'SPOP_DAILYSUM_JACHI', name: '주민등록인구(자치구)', category: '생활·인구', description: '자치구별 일별 생활인구 합계 통계', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['STDR_DE_ID', 'SIGNGU_CODE_SE', 'SIGNGU_NM'], callable: true }),
  E({ id: 'TbPublicWifiInfo', name: '공공와이파이 위치', category: '생활·인구', description: '무료 공공 와이파이 WiFi 설치 위치, 장소', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['X_SWIFI_MGR_NO', 'X_SWIFI_WRDOFC', 'X_SWIFI_MAIN_NM'], callable: true }),
  E({ id: 'TbGtnHwcwP', name: '무더위쉼터', category: '생활·인구', description: '폭염 대비 무더위 쉼터 위치, 냉방 시설', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['YEAR', 'AREA_CD', 'FACILITY_TYPE1'], callable: true }),
  E({ id: 'tbLnOpendataRentV', name: '부동산 전월세가', category: '부동산·경제', description: '아파트 주택 전세 월세 임대차 실거래, 보증금', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'RCPT_YR', required: false, example: '2025', description: '접수연도 YYYY' }, { name: 'CGG_CD', required: false, example: '11680', description: '자치구코드 5자리' }, { name: 'CGG_NM', required: false, example: '강남구', description: '자치구명 전체(강남구)' }, { name: 'STDG_CD', required: false, example: '10100', description: '법정동코드 5자리' }, { name: 'LOTNO_SE', required: false, example: '1', description: '지번구분 코드' }, { name: 'MNO', required: false, example: '0737', description: '본번 4자리' }, { name: 'SNO', required: false, example: '0000', description: '부번 4자리' }, { name: 'CTRT_DAY', required: false, example: '20250301', description: '계약일 YYYYMMDD' }, { name: 'BLDG_NM', required: false, example: '타워팰리스', description: '건물명(부분일치)' }, { name: 'BLDG_USG', required: false, example: '아파트', description: '건물용도: 아파트, 연립다세대, 단독다가구, 오피스텔' }], sampleFields: ['RCPT_YR', 'CGG_NM', 'STDG_NM', 'BLDG_NM', 'RENT_SE', 'GRFE', 'RTFE', 'CTRT_DAY'], tool: 'get_real_estate_prices', callable: true }),
  E({ id: 'VwsmTrdarSelngQq', name: '골목상권 추정매출', category: '부동산·경제', description: '상권별 업종별 분기 추정 매출액 통계', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['STDR_YYQU_CD', 'TRDAR_SE_CD', 'TRDAR_SE_CD_NM'], callable: true }),
  E({ id: 'ListTraditionalMarket', name: '전통시장 현황', category: '부동산·경제', description: '전통시장 위치, 점포 수, 유형', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CGG', 'MRKT_NM', 'SHP', 'ADDR', 'TYPE', 'TELNO'], callable: true }),
  E({ id: 'ListNecessariesPricesService', name: '생필품 물가정보', category: '부동산·경제', description: '생활필수품 농수산물 시장별 가격, 물가', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['P_SEQ', 'M_NAME', 'A_NAME', 'A_PRICE'], callable: true }),
  E({ id: 'culturalSpaceInfo', name: '문화공간 정보', category: '문화·여가', description: '미술관, 박물관, 공연장, 문화시설 위치와 정보', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['SUBJCODE', 'FAC_NAME', 'ADDR'], callable: true }),
  E({ id: 'SearchParkInfoService', name: '도시공원 정보', category: '문화·여가', description: '공원 위치, 면적, 개원일, 주요 시설', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['PARK_NM', 'PARK_OTLN', 'AREA', 'OPEN_YMD'], callable: true }),
  E({ id: 'SeoulPublicLibraryInfo', name: '공공도서관 현황', category: '문화·여가', description: '도서관 위치, 운영시간, 휴관일', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['LBRRY_NAME', 'GU_CODE', 'ADRES'], callable: true }),
  E({ id: 'TbHospitalInfo', name: '병원 정보', category: '보건·복지', description: '병원 의원 위치, 진료과목, 전화번호', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['HPID', 'DUTYNAME', 'DUTYADDR', 'DUTYDIVNAM'], callable: true }),
  E({ id: 'ChildCareInfo', name: '어린이집 정보', category: '보건·복지', description: '어린이집 위치, 유형, 정원 보육 정보', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['SIGUNNAME', 'CRNAME', 'CRTYPENAME'], callable: true }),
  E({ id: 'TimeAverageAirQuality', name: '시간평균 대기질', category: '안전·환경', description: '측정시각 기준 자치구별 시간평균 대기오염 농도', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MSRMT_DT', required: true, example: '202608151100', description: '측정시각 YYYYMMDDHHMM(정시)' }], sampleFields: ['MSRMT_DT', 'MSRSTN_NM', 'NTDX', 'OZON'], callable: true }),
]

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

const bigrams = (s: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** name/description/category 부분일치 우선, 2-gram 겹침 보조 — 상위 5개 */
export function searchCatalog(query: string): DatasetEntry[] {
  const q = norm(query)
  if (!q) return []
  const scored = CATALOG.map(e => {
    const hay = norm(`${e.name} ${e.description} ${e.category}`)
    let score = 0
    for (const token of query.split(/\s+/).map(norm).filter(Boolean)) {
      if (token && hay.includes(token)) score += 10
    }
    const qb = bigrams(q), hb = bigrams(hay)
    let hit = 0
    for (const g of qb) if (hb.has(g)) hit++
    score += hit / Math.max(qb.size, 1)
    return { e, score }
  }).filter(x => x.score >= 1)
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map(x => x.e)
}

/** 호출 예시용 params — 마지막 필수 인자 자리까지만 채우고, 그 사이 선택 자리는 공백(건너뛰기)으로 둔다 */
export function exampleParams(entry: DatasetEntry): string[] {
  const last = entry.pathParams.reduce((acc, p, i) => (p.required ? i : acc), -1)
  return entry.pathParams.slice(0, last + 1).map(p => (p.required ? p.example : ' '))
}

/** call_dataset 사전 검증 — 문제 없으면 null, 있으면 한국어 안내문 */
export function validateCall(entry: DatasetEntry, params: string[]): string | null {
  if (!entry.callable) {
    return `'${entry.id}'은(는) 직접 호출 대상이 아닙니다. 정식 tool '${entry.tool}'을(를) 사용하세요.`
  }
  // 경로 파라미터는 자리로 구분된다 — 개수가 아니라 필수 인자의 자리가 채워졌는지 본다
  const missing = entry.pathParams
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.required && !(params[i] ?? '').trim())
  if (missing.length > 0) {
    const spec = missing.map(({ p, i }) => `${p.name}(${i + 1}번째, 예: ${p.example}) — ${p.description}`).join('; ')
    const skip = entry.pathParams.length > 1 ? " 건너뛰는 자리는 공백 문자 ' '로 채우세요." : ''
    return `필수 경로 파라미터가 필요합니다: ${spec}. params 배열에 순서대로 전달하세요.${skip}`
  }
  return null
}
