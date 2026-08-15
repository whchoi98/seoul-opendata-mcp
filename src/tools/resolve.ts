import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { searchPlace } from '../data/placeMatcher.js'

/** place 질의를 핫스팟명으로 확정하거나, 후보 목록 응답을 만들어 돌려준다 */
export function resolvePlace(query: string, ctx: Ctx): { name: string } | { early: ReturnType<typeof ok> } {
  const { match, candidates } = searchPlace(query)
  if (match) return { name: match.name }
  return {
    early: ok(
      { requested: query, match: null, candidates, hint: 'candidates 중 정확한 name으로 다시 호출하세요. 실시간 데이터는 121개 핫스팟만 지원합니다.' },
      { source: 'built-in hotspots.ts', sample: ctx.client.isSample },
    ),
  }
}
