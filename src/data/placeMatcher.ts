import { HOTSPOTS, type Hotspot } from './hotspots.js'

// 자주 쓰는 통칭 → 정식 핫스팟명 (정규화된 키로 조회)
const ALIASES: Record<string, string> = {
  '코엑스': '강남 MICE 관광특구', 'coex': '강남 MICE 관광특구',
  '롯데타워': '잠실롯데타워·석촌호수', '롯데월드': '잠실롯데타워·석촌호수', '석촌호수': '잠실롯데타워·석촌호수',
  '동대문디자인플라자': 'DDP(동대문디자인플라자)', 'ddp': 'DDP(동대문디자인플라자)',
  '디지털미디어시티': 'DMC(디지털미디어시티)', 'dmc': 'DMC(디지털미디어시티)',
  '광화문': '광화문·덕수궁', '덕수궁': '광화문·덕수궁', '경리단길': '해방촌·경리단길',
  '가로수길': '가로수길', '광장시장': '광장(전통)시장', '북촌': '북촌한옥마을',
  '홍대입구': '홍대입구역(2호선)', '홍대입구역': '홍대입구역(2호선)',
  '이수역': '총신대입구(이수)역', '총신대입구역': '총신대입구(이수)역',
  '마곡나루역': '서울식물원·마곡나루역', '서울식물원': '서울식물원·마곡나루역',
  '송리단길': '송리단길·호수단길', '신촌역': '신촌·이대역', '이대역': '신촌·이대역',
  '잠실야구장': '잠실종합운동장', '석촌': '잠실롯데타워·석촌호수',
  'gangnam': '강남역', 'hongdae': '홍대 관광특구', 'myeongdong': '명동 관광특구', 'itaewon': '이태원 관광특구',
}

/** 소문자화, 공백/중점/괄호/하이픈 제거 */
export const normalizeQuery = (q: string): string =>
  q.toLowerCase().replace(/[\s·()\-]/g, '')

const byName = new Map(HOTSPOTS.map(h => [normalizeQuery(h.name), h]))

/** 2-gram 겹침 점수 (후보 제안용) */
const bigrams = (s: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}
const overlap = (a: string, b: string): number => {
  const A = bigrams(a), B = bigrams(b)
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / Math.max(A.size, 1)
}

export function searchPlace(query: string): { match: Hotspot | null; candidates: Hotspot[] } {
  const q = normalizeQuery(query)
  if (!q) return { match: null, candidates: [] }

  const exact = byName.get(q)
  if (exact) return { match: exact, candidates: [] }

  const alias = ALIASES[q]
  if (alias) return { match: byName.get(normalizeQuery(alias)) ?? null, candidates: [] }

  // 부분일치: 질의⊂이름 또는 이름⊂질의
  const partial = HOTSPOTS.filter(h => {
    const n = normalizeQuery(h.name)
    return n.includes(q) || q.includes(n)
  })
  if (partial.length === 1) return { match: partial[0], candidates: [] }
  if (partial.length > 1) return { match: null, candidates: partial.slice(0, 5) }

  // 유사도 상위 후보 제안
  const scored = HOTSPOTS
    .map(h => ({ h, s: overlap(q, normalizeQuery(h.name)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
  return { match: null, candidates: scored.slice(0, 5).map(x => x.h) }
}
