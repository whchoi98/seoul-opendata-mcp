export const toArray = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v])

export const num = (v: any): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export const KEY_GUIDE =
  '인증키 무료 발급: https://data.seoul.go.kr → 로그인 → 인증키 신청 (5분 소요)'

const ENTITIES: Record<string, string> = { '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' }

/** 응답 문자열에 섞여 오는 HTML 엔티티 몇 가지를 문자로 바꾼다. &amp;는 마지막에 풀어 이중 해제를 막는다 */
export const decodeEntities = (v: any): string =>
  String(v ?? '').replace(/&(#39|quot|lt|gt);/g, m => ENTITIES[m]).replace(/&amp;/g, '&')
