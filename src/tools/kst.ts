// 서울 기준(KST, UTC+9) 날짜와 시각. 서버가 어느 시간대에서 돌든 같은 값을 쓴다
const HOUR = 3_600_000
const kst = (offsetHours = 0) => new Date(Date.now() + (9 + offsetHours) * HOUR)

export const kstYear = () => kst().getUTCFullYear()

/** 1~12 (KST) */
export const kstMonth = () => kst().getUTCMonth() + 1

/** 'HH:MM' (KST 현재 시각) */
export const kstHHMM = () => kst().toISOString().slice(11, 16)

/**
 * 지하철 운행일 기준 요일 구분. 새벽 4시 전은 전날 운행으로 본다(금요일 밤 막차는 토요일 01시에도 평일 시간표).
 * 공휴일은 알 수 없으므로 일요일만 holiday로 본다
 */
export function serviceDayType(): 'weekday' | 'saturday' | 'holiday' {
  const d = kst(-4).getUTCDay()
  return d === 0 ? 'holiday' : d === 6 ? 'saturday' : 'weekday'
}

/** 오늘(KST) 기준 n개월 전의 'YYYYMM' */
export function kstMonthsAgo(n: number): string {
  const now = kst()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 오늘(KST)에서 'YYYYMMDD'까지 지난 날 수. 미래 날짜면 음수 */
export function kstDaysAgo(yyyymmdd: string): number {
  const target = Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)))
  const now = kst()
  return Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - target) / 86_400_000)
}
