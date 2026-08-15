// 샘플 키로 실응답을 tests/fixtures/에 저장한다. 실행: npx tsx scripts/capture-fixtures.ts
import { writeFileSync, mkdirSync } from 'node:fs'

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
}

mkdirSync('tests/fixtures', { recursive: true })
for (const [file, url] of Object.entries(targets)) {
  const res = await fetch(url)
  writeFileSync(`tests/fixtures/${file}`, await res.text())
  console.log(`saved tests/fixtures/${file} (${res.status})`)
}
