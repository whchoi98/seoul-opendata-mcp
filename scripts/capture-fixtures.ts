// 샘플 키로 실응답을 tests/fixtures/에 저장한다. 실행: npx tsx scripts/capture-fixtures.ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'

const PLACE = encodeURIComponent('광화문·덕수궁')
const targets: Record<string, string> = {
  'ppltn.json': `http://openapi.seoul.go.kr:8088/sample/json/citydata_ppltn/1/5/${PLACE}`,
  'cmrcl.json': `http://openapi.seoul.go.kr:8088/sample/json/citydata_cmrcl/1/5/${PLACE}`,
  'citydata.xml': `http://openapi.seoul.go.kr:8088/sample/xml/citydata/1/5/${PLACE}`,
  'bike.json': 'http://openapi.seoul.go.kr:8088/sample/json/bikeList/1/5/',
  'culture.json': 'http://openapi.seoul.go.kr:8088/sample/json/culturalEventInfo/1/5/',
  'parking.json': 'http://openapi.seoul.go.kr:8088/sample/json/GetParkingInfo/1/5/',
  'air.json': 'http://openapi.seoul.go.kr:8088/sample/json/RealtimeCityAir/1/5/',
  'subway.json': `http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimeStationArrival/0/5/${encodeURIComponent('강남')}`,
  'subway_stats.json': 'http://openapi.seoul.go.kr:8088/sample/json/CardSubwayStatsNew/1/5/20260801',
  'bus_stats.json': 'http://openapi.seoul.go.kr:8088/sample/json/CardBusStatisticsServiceNew/1/5/20260801',
  'living_pop.json': 'http://openapi.seoul.go.kr:8088/sample/json/SPOP_LOCAL_RESD_DONG/1/5/',
  'realestate.json': 'http://openapi.seoul.go.kr:8088/sample/json/tbLnOpendataRtmsV/1/5/',
  'realestate_rent.json': 'http://openapi.seoul.go.kr:8088/sample/json/tbLnOpendataRentV/1/5/',
  // 공시지가: SIGUNGU_NM/BJDONG_NM/BONBEON/BUBEON/PILGI_CD/YEAR — 건너뛰는 자리는 공백(%20)
  'landprice.json': `http://openapi.seoul.go.kr:8088/sample/json/IndividuallyPostedLandPriceService/1/5/${encodeURIComponent('강남구')}/${encodeURIComponent('역삼동')}/%20/%20/%20/2025`,
  'pharmacy.json': 'http://openapi.seoul.go.kr:8088/sample/json/TbPharmacyOperateInfo/1/5/',
  'accinfo.xml': 'http://openapi.seoul.go.kr:8088/sample/xml/AccInfo/1/5/',
  'parkinfo.json': 'http://openapi.seoul.go.kr:8088/sample/json/GetParkInfo/1/5/',
  'subway_station.json': `http://openapi.seoul.go.kr:8088/sample/json/SearchInfoBySubwayNameService/1/5/${encodeURIComponent('서울역')}`,
  // 첫차·막차: SBWY_ROUT_LN/UPLN_DNLN/DOW (1호선~9호선, 1=상행·내선, 1=평일)
  'subway_firstlast.json': `http://openapi.seoul.go.kr:8088/sample/json/SearchFirstAndLastTrainbyLineServiceNew/1/5/${encodeURIComponent('2호선')}/1/1/`,
  'subway_timetable.json': 'http://openapi.seoul.go.kr:8088/sample/json/SearchSTNTimeTableByIDService/1/5/0222/1/1/',
  'subway_hourly.json': 'http://openapi.seoul.go.kr:8088/sample/json/CardSubwayTime/1/5/202610/',
  'reservation.json': 'http://openapi.seoul.go.kr:8088/sample/json/ListPublicReservationSport/1/5/',
}

mkdirSync('tests/fixtures', { recursive: true })
for (const [file, url] of Object.entries(targets)) {
  const path = `tests/fixtures/${file}`
  if (existsSync(path)) {
    console.log(`skip (exists) tests/fixtures/${file}`)
    continue
  }
  const res = await fetch(url)
  writeFileSync(path, await res.text())
  console.log(`saved tests/fixtures/${file} (${res.status})`)
  await new Promise(r => setTimeout(r, 1200))
}
