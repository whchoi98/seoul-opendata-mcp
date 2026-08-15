export const toArray = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v])

export const num = (v: any): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export const KEY_GUIDE =
  '인증키 무료 발급: https://data.seoul.go.kr → 로그인 → 인증키 신청 (5분 소요)'
