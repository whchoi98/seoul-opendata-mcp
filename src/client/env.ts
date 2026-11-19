import { readFileSync, existsSync } from 'node:fs'

/** .env 형식 문자열을 KEY=VALUE 맵으로 읽는다. 주석과 빈 줄은 건너뛰고, 값을 감싼 따옴표 한 쌍을 벗기며, 같은 키는 처음 비어 있지 않은 값을 쓴다 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (out[key] === undefined || out[key] === '') out[key] = val
  }
  return out
}

/** CWD(또는 지정 경로)의 .env를 읽어, 아직 설정되지 않은 환경변수만 채운다. 명시적 env > .env */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return
  for (const [key, val] of Object.entries(parseDotEnv(readFileSync(path, 'utf8')))) {
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val
  }
}
