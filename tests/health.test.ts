import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizePharmacies } from '../src/normalize/health.js'
import { rowsUpstream, callTool } from './helpers/mcp.js'

const rows = unwrap('TbPharmacyOperateInfo', JSON.parse(readFileSync('tests/fixtures/pharmacy.json', 'utf8'))).rows

describe('normalizePharmacies — 매핑 동등성 (재캡처 안전)', () => {
  it('이름/주소/전화 매핑 일치', () => {
    const a = normalizePharmacies(rows)
    expect(a.length).toBe(rows.length)
    rows.forEach((r: any, i: number) => {
      expect(a[i].name).toBe(r.DUTYNAME ?? '')
      expect(a[i].address).toBe(r.DUTYADDR ?? '')
      expect(a[i].tel).toBe(r.DUTYTEL1 ?? '')
    })
  })
  it('요일별 운영시간: 월요일 키 존재, HHMM-HHMM 형식 또는 빈 문자열', () => {
    const a = normalizePharmacies(rows)
    expect(a[0].hours).toHaveProperty('월')
    expect(a[0].hours['월']).toMatch(/^(\d{4}-\d{4}|)$/)
  })
})

// ── tool 경로: district는 DUTYADDR(1번 자리), name은 DUTYNAME(2번 자리)으로 서버에서 거른다 ──
describe('find_pharmacies — 서버 쪽 필터', () => {
  const B = ' '
  const gangnam = rows.map((r: any, i: number) => ({ ...r, DUTYNAME: `강남${i}온누리약국`, DUTYADDR: `서울특별시 강남구 테헤란로 ${i}` }))
  const run = async (args: Record<string, unknown>, total = gangnam.length) => {
    const { fetchFn, calls } = rowsUpstream(() => ({ rows: gangnam, total }))
    const body = await callTool(fetchFn, 'find_pharmacies', args)
    return { body, calls }
  }

  it('district를 1번 자리로 보낸다', async () => {
    const { calls } = await run({ district: '강남구' })
    expect(calls.map(c => c.path)).toEqual([['강남구']])
  })
  it('name만 주면 1번 자리를 공백으로 채운다', async () => {
    const { calls } = await run({ name: '온누리' })
    expect(calls.map(c => c.path)).toEqual([[B, '온누리']])
  })
  it('district와 name을 함께 보낸다', async () => {
    const { calls } = await run({ district: '강남구', name: '온누리' })
    expect(calls.map(c => c.path)).toEqual([['강남구', '온누리']])
  })
  it('업스트림 호출은 1회이고 전체 건수를 돌려준다', async () => {
    const { body, calls } = await run({ district: '강남구' }, 527)
    expect(calls).toHaveLength(1)
    expect(body.data.totalCount).toBe(527)
    expect(body.data.count).toBe(gangnam.length)
  })
  it('전체 건수가 받은 건수보다 많을 때만 범위 안내를 붙인다', async () => {
    const narrow = await run({ district: '강남구' })
    expect(narrow.body.notes.join(' ')).not.toContain('건만 받았습니다')
    const broad = await run({ district: '서울' }, 5636)
    expect(broad.body.notes.join(' ')).toContain(`5,636건 중 앞 ${gangnam.length}건만 받았습니다`)
  })
})
