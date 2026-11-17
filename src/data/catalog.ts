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
  E({ id: 'TbPharmacyOperateInfo', name: '약국 운영정보', category: '보건·복지', description: '약국 위치, 전화번호, 요일별 운영시간', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'DUTYADDR', required: false, example: '강남구', description: '주소(부분일치)' }, { name: 'DUTYNAME', required: false, example: '온누리', description: '약국명(부분일치)' }], sampleFields: ['DUTYNAME', 'DUTYADDR', 'DUTYTEL1', 'DUTYTIME1S', 'DUTYTIME1C'], tool: 'find_pharmacies', callable: true }),
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
  // ── 추가 정식 tool 대상 10종 (get_subway_schedule, get_subway_hourly_ridership, get_parking, search_public_reservations) ──
  E({ id: 'CardSubwayTime', name: '지하철 역별 시간대별 승하차', category: '교통·이동', description: '지하철 호선별 역별 시간대별 승차 하차 인원 월 합계, 출퇴근 붐비는 시간', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'USE_MM', required: true, example: '202610', description: '사용월 YYYYMM' }, { name: 'SBWY_ROUT_LN_NM', required: false, example: '2호선', description: '호선명' }, { name: 'STTN', required: false, example: '강남', description: '역명(정확히 일치)' }], sampleFields: ['USE_MM', 'SBWY_ROUT_LN_NM', 'STTN', 'HR_8_GET_ON_NOPE', 'HR_8_GET_OFF_NOPE'], tool: 'get_subway_hourly_ridership', callable: true }),
  E({ id: 'SearchFirstAndLastTrainbyLineServiceNew', name: '지하철 첫차·막차', category: '교통·이동', description: '지하철 1~9호선 역별 첫차 막차 시간, 상행 하행, 평일 토요일 휴일', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'SBWY_ROUT_LN', required: true, example: '2호선', description: '호선(1호선~9호선)' }, { name: 'UPLN_DNLN', required: true, example: '1', description: '1=상행·내선, 2=하행·외선' }, { name: 'DOW', required: true, example: '1', description: '1=평일, 2=토요일, 3=휴일' }, { name: 'SUBW_CD', required: false, example: '0222', description: '전철역코드' }, { name: 'OTSD_CD', required: false, example: '222', description: '외부코드(역번호)' }], sampleFields: ['STTN', 'FSTT_HRM', 'FSTT_DPTRE_STTN', 'LSTTM_HRM', 'LSTTM_ARVL_STTN'], tool: 'get_subway_schedule', callable: true }),
  E({ id: 'SearchSTNTimeTableByIDService', name: '지하철 역별 열차 시간표', category: '교통·이동', description: '지하철역 열차 시간표, 출발 도착 시각, 행선지, 1~9호선', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'STATION_CD', required: true, example: '0222', description: '전철역코드' }, { name: 'WEEK_TAG', required: true, example: '1', description: '1=평일, 2=토요일, 3=휴일' }, { name: 'INOUT_TAG', required: true, example: '1', description: '1=상행·내선, 2=하행·외선' }], sampleFields: ['STATION_NM', 'TRAIN_NO', 'LEFTTIME', 'SUBWAYENAME'], tool: 'get_subway_schedule', callable: true }),
  E({ id: 'SearchInfoBySubwayNameService', name: '지하철역 코드 검색', category: '교통·이동', description: '역명으로 지하철 전철역 코드, 호선, 외부코드(역번호) 검색', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'STATION_NM', required: false, example: '강남', description: '역명(정확히 일치)' }], sampleFields: ['STATION_CD', 'STATION_NM', 'LINE_NUM', 'FR_CODE'], tool: 'get_subway_schedule', callable: true }),
  E({ id: 'GetParkInfo', name: '공영주차장 안내', category: '교통·이동', description: '공영주차장 위치, 주차 요금, 운영시간, 야간 무료 개방, 주차면수 안내(실시간 미연계 포함)', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'ADDR', required: false, example: '강남', description: '주소(부분일치)' }, { name: 'PKLT_CD', required: false, example: '1033125', description: '주차장코드' }, { name: 'PRK_NOW_INFO_PVSN_YN', required: false, example: '1', description: '실시간 정보: 1=제공, 2=수집중, 3=점검중, 0=미연계' }], sampleFields: ['PKLT_NM', 'ADDR', 'CHGD_FREE_NM', 'PRK_CRG', 'WD_OPER_BGNG_TM', 'NGHT_FREE_OPN_YN'], tool: 'get_parking', callable: true }),
  E({ id: 'ListPublicReservationCulture', name: '공공서비스예약(문화체험)', category: '문화·여가', description: '공공서비스예약 문화체험 교육체험 산림여가 서울형키즈카페 공원탐방 전시 예약 신청', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MINCLASSNM', required: false, example: '교육체험', description: '소분류명(부분일치)' }], sampleFields: ['SVCNM', 'MINCLASSNM', 'SVCSTATNM', 'PAYATNM', 'AREANM', 'SVCURL'], tool: 'search_public_reservations', callable: true }),
  E({ id: 'ListPublicReservationSport', name: '공공서비스예약(체육시설)', category: '문화·여가', description: '공공서비스예약 체육시설 테니스장 풋살장 축구장 파크골프장 농구장 예약 신청', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MINCLASSNM', required: false, example: '테니스장', description: '소분류명(부분일치)' }], sampleFields: ['SVCNM', 'MINCLASSNM', 'SVCSTATNM', 'PAYATNM', 'AREANM', 'SVCURL'], tool: 'search_public_reservations', callable: true }),
  E({ id: 'ListPublicReservationInstitution', name: '공공서비스예약(공간시설)', category: '문화·여가', description: '공공서비스예약 공간시설 대관 강의실 회의실 다목적실 캠핑장 공연장 예약 신청', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MINCLASSNM', required: false, example: '캠핑장', description: '소분류명(부분일치)' }], sampleFields: ['SVCNM', 'MINCLASSNM', 'SVCSTATNM', 'PAYATNM', 'AREANM', 'SVCURL'], tool: 'search_public_reservations', callable: true }),
  E({ id: 'ListPublicReservationEducation', name: '공공서비스예약(교육강좌)', category: '문화·여가', description: '공공서비스예약 교육강좌 강좌 수강 신청, 자연 과학 역사 도시농업', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MINCLASSNM', required: false, example: '역사', description: '소분류명(부분일치)' }, { name: 'SVCNM', required: false, example: '한양도성', description: '서비스명(부분일치)' }, { name: 'USETGTINFO', required: false, example: '초등학교', description: '서비스대상' }, { name: 'AREANM', required: false, example: '종로구', description: '지역명' }], sampleFields: ['SVCNM', 'MINCLASSNM', 'SVCSTATNM', 'PAYATNM', 'AREANM', 'SVCURL'], tool: 'search_public_reservations', callable: true }),
  E({ id: 'ListPublicReservationMedical', name: '공공서비스예약(진료복지)', category: '보건·복지', description: '공공서비스예약 진료복지 어린이병원 보건소 산후조리원 장애인버스 예약', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'MINCLASSNM', required: false, example: '어린이병원', description: '소분류명(부분일치)' }], sampleFields: ['SVCNM', 'MINCLASSNM', 'SVCSTATNM', 'PAYATNM', 'AREANM', 'SVCURL'], tool: 'search_public_reservations', callable: true }),
  // ── 추가 카탈로그 전용 13종 (call_dataset으로 호출) ──
  E({ id: 'TbGtnCwP', name: '한파쉼터', category: '생활·인구', description: '겨울철 한파 대비 한파쉼터 위치, 이용 가능 인원, 시설 유형, 운영 비고', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['RESTAREA_NM', 'ROAD_NM_ADDR', 'UTZTN_PSBLTY_NOPE', 'FACILITY_TYPE2', 'RMRK'], callable: true }),
  E({ id: 'tbClicomCnt', name: '기후동행쉼터', category: '생활·인구', description: '폭염 한파 기후동행쉼터 위치, 운영시간, 자치구', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CNT_GB', 'CNT_NM', 'GU_NM', 'ROAD_NM_ADDR', 'OPER_HR'], callable: true }),
  E({ id: 'tnFcltySttusInfo1011', name: '서울형 키즈카페', category: '문화·여가', description: '서울형 키즈카페 위치, 이용 가능 연령, 사용료 무료 여부, 운영일, 영유아 아이 실내 놀이', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'FCLTY_NM', required: false, example: '솔밭', description: '시설명(부분일치)' }], sampleFields: ['FCLTY_NM', 'ATDRC_NM', 'BASS_ADRES', 'RNTFEE_FREE_AT', 'POSBL_AGRDE', 'OPEN_WEEK'], callable: true }),
  E({ id: 'TvEmgcHospitalInfo', name: '응급실 운영 병원', category: '보건·복지', description: '응급실 운영 병원 위치, 응급실 전화, 응급의료기관 종류, 진료시간', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['DUTYNAME', 'DUTYADDR', 'DUTYEMCLSNAME', 'DUTYTEL3', 'DUTYERYN'], callable: true }),
  E({ id: 'mgis1708328729039Point', name: '서울형 소아의료체계', category: '보건·복지', description: '소아 야간 휴일 진료 병원, 소아 응급 진료 범위, 운영시간, 아이 열날 때', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CONTS_NAME', 'GU_NAME', 'ADDR_NEW', 'TEL_NO', 'VALUE_01', 'VALUE_02'], callable: true }),
  E({ id: 'AiRainfallService', name: '강우량 정보', category: '안전·환경', description: '자치구별 강우량계 10분 강우량, 비 강수량 실시간, 호우', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'GU_NM', required: false, example: '강남구', description: '구청명' }, { name: 'DATA_CLCT_TM', required: false, example: '2026-11-17', description: '자료수집 일자 yyyy-mm-dd' }], sampleFields: ['RF_NM', 'GU_NM', 'RN_10M', 'DATA_CLCT_TM'], callable: true }),
  E({ id: 'ListRiverStageService', name: '하천 수위', category: '안전·환경', description: '하천 수위계 실시간 하천 수위, 계획홍수위, 통제수위, 탄천 중랑천 안양천 홍수', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'RVR_NM', required: false, example: '탄천', description: '하천명' }], sampleFields: ['WATG_NM', 'RVR_NM', 'RLTM_RVR_WATL_CNT', 'PLAN_FLDE', 'CNTRL_WATL'], callable: true }),
  E({ id: 'SeoulMetroFaciInfo', name: '지하철 승강기 가동현황', category: '교통·이동', description: '지하철역 엘리베이터 에스컬레이터 휠체어리프트 승강기 운행 상태, 교통약자 유모차', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['STN_NM', 'ELVTR_NM', 'INSTL_PSTN', 'USE_YN', 'ELVTR_SE'], callable: true }),
  E({ id: 'goodPrices', name: '착한가격업소', category: '부동산·경제', description: '착한가격업소 업소명, 업종, 메뉴와 가격, 저렴한 식당 이발 미용', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['SGG_NM', 'TPBIZ', 'COMM_NM', 'MENU_01', 'PRC_01'], callable: true }),
  E({ id: 'ListPriceModelStoreService', name: '가격안정 모범업소', category: '부동산·경제', description: '물가 가격안정 모범업소 업소명, 업종, 주소, 영업시간', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'INDUTY_CODE_SE', required: false, example: '002', description: '분류코드(예: 002 중식, 005 이미용)' }], sampleFields: ['SH_NAME', 'INDUTY_CODE_SE_NAME', 'SH_ADDR', 'SH_INFO'], callable: true }),
  E({ id: 'OdsnBuildingInfo', name: '경로당 현황', category: '보건·복지', description: '경로당 노인여가복지시설 위치, 주소, 전화번호, 어르신', responseType: 'json', endpoint: 'open', pathParams: [{ name: 'SISUL_NM', required: false, example: '더샵둔촌포레(둔촌현대1차A)', description: '시설명(경로당명)' }], sampleFields: ['SIGUN_NM', 'SISUL_NM', 'ADDRESS', 'TEL_NUMBER'], callable: true }),
  E({ id: 'mgisToiletPoi', name: '공중화장실 위치', category: '생활·인구', description: '공중화장실 개방화장실 위치, 개방시간, 장애인화장실, 편의시설', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['CONTS_NAME', 'GU_NAME', 'ADDR_NEW', 'VALUE_02', 'VALUE_05'], callable: true }),
  E({ id: 'LOCALDATA_020301', name: '동물병원 인허가', category: '생활·인구', description: '동물병원 반려동물 병원 위치, 전화, 영업상태(폐업 포함)', responseType: 'json', endpoint: 'open', pathParams: [], sampleFields: ['BPLCNM', 'RDNWHLADDR', 'SITETEL', 'TRDSTATENM'], callable: true }),
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
