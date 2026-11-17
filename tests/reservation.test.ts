import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { num, decodeEntities } from '../src/normalize/util.js'
import { normalizeReservations } from '../src/normalize/reservation.js'
import { rowsUpstream, callTool } from './helpers/mcp.js'

const rows = unwrap('ListPublicReservationSport', JSON.parse(readFileSync('tests/fixtures/reservation.json', 'utf8'))).rows

describe('decodeEntities', () => {
  it('자주 나오는 HTML 엔티티를 문자로 바꾼다', () => {
    expect(decodeEntities('&#39;우리 가족&#39; &quot;탐험&quot; A&amp;B &lt;1&gt;')).toBe('\'우리 가족\' "탐험" A&B <1>')
    expect(decodeEntities(undefined)).toBe('')
  })
})

describe('normalizeReservations — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치하고 상세 HTML(DTLCONT)은 버린다', () => {
    const a = normalizeReservations(rows)
    expect(a.length).toBe(rows.length)
    const dt = (v: any) => String(v ?? '').replace(/\.0$/, '')
    rows.forEach((r: any, i: number) => {
      expect(a[i].id).toBe(String(r.SVCID ?? ''))
      expect(a[i].name).toBe(decodeEntities(r.SVCNM))
      expect(a[i].category).toBe(r.MAXCLASSNM ?? '')
      expect(a[i].subcategory).toBe(r.MINCLASSNM ?? '')
      expect(a[i].status).toBe(r.SVCSTATNM ?? '')
      expect(a[i].payment).toBe(r.PAYATNM ?? '')
      expect(a[i].place).toBe(decodeEntities(r.PLACENM))
      expect(a[i].district).toBe(r.AREANM ?? '')
      expect(a[i].target).toBe(String(r.USETGTINFO ?? '').trim())
      expect(a[i].url).toBe(r.SVCURL ?? '')
      expect(a[i].serviceStart).toBe(dt(r.SVCOPNBGNDT))
      expect(a[i].serviceEnd).toBe(dt(r.SVCOPNENDDT))
      expect(a[i].receiptStart).toBe(dt(r.RCPTBGNDT))
      expect(a[i].receiptEnd).toBe(dt(r.RCPTENDDT))
      expect(a[i].useHours).toBe(r.V_MIN && r.V_MAX ? `${r.V_MIN}~${r.V_MAX}` : '')
      expect(a[i].tel).toBe(r.TELNO ?? '')
      expect(a[i].lat).toBe(num(r.Y))
      expect(a[i].lng).toBe(num(r.X))
      expect(a[i]).not.toHaveProperty('detail')
    })
  })
})

// ── tool 경로: 분야별 서비스 선택, 소분류는 서버(1번 자리), 나머지 조건은 코드에서 거른다 ──
describe('search_public_reservations tool', () => {
  const base = rows[0]
  const sample = [
    { ...base, SVCID: 'a', SVCNM: '잠실 테니스장', PLACENM: '잠실유수지', AREANM: '송파구', PAYATNM: '무료', SVCSTATNM: '접수중', USETGTINFO: ' 제한없음' },
    { ...base, SVCID: 'b', SVCNM: '응봉공원 테니스장', PLACENM: '응봉공원', AREANM: '성동구', PAYATNM: '유료', SVCSTATNM: '접수중', USETGTINFO: ' 성인' },
    { ...base, SVCID: 'c', SVCNM: '가락 테니스장', PLACENM: '가락시장', AREANM: '송파구', PAYATNM: '유료', SVCSTATNM: '예약마감', USETGTINFO: ' 어린이' },
  ]
  const run = async (args: Record<string, unknown>) => {
    const { fetchFn, calls } = rowsUpstream(() => ({ rows: sample }))
    const body = await callTool(fetchFn, 'search_public_reservations', args)
    return { body, calls, ids: body.data.reservations?.map((r: any) => r.id) }
  }

  it('category로 서비스를 고르고 subcategory를 1번 자리로 보낸다', async () => {
    const { calls } = await run({ category: 'sports', subcategory: '테니스장' })
    expect(calls.map(c => [c.svc, c.path])).toEqual([['ListPublicReservationSport', ['테니스장']]])
  })
  it('분야별 서비스 이름 대응', async () => {
    for (const [category, svc] of [['culture', 'ListPublicReservationCulture'], ['facility', 'ListPublicReservationInstitution'], ['education', 'ListPublicReservationEducation'], ['medical', 'ListPublicReservationMedical']]) {
      const { calls } = await run({ category })
      expect(calls.map(c => [c.svc, c.path])).toEqual([[svc, []]])
    }
  })
  it('district는 구 이름 일부로도 거른다', async () => {
    expect((await run({ category: 'sports', district: '송파' })).ids).toEqual(['a', 'c'])
  })
  it('freeOnly, openOnly, keyword, target 조건을 함께 적용한다', async () => {
    expect((await run({ category: 'sports', freeOnly: true })).ids).toEqual(['a'])
    expect((await run({ category: 'sports', openOnly: true })).ids).toEqual(['a', 'b'])
    expect((await run({ category: 'sports', keyword: '응봉' })).ids).toEqual(['b'])
    expect((await run({ category: 'sports', keyword: '가락시장' })).ids).toEqual(['c'])
    expect((await run({ category: 'sports', target: '어린이' })).ids).toEqual(['c'])
  })
  it('결과가 없으면 조건을 줄이라고 안내한다', async () => {
    const { body } = await run({ category: 'sports', district: '강서구' })
    expect(body.data.count).toBe(0)
    expect(body.notes.join(' ')).toContain('조건에 맞는 예약 서비스가 없습니다')
  })
})
