import { KEY_GUIDE } from '../normalize/util.js'

const SAMPLE_NOTE = `샘플 키 사용 중 — citydata 계열은 광화문·덕수궁만, 일반 API는 5행만 조회됩니다. ${KEY_GUIDE}`

export function ok(data: unknown, opts: { source: string; asOf?: string | null; notes?: string[]; sample?: boolean }) {
  const notes = [...(opts.notes ?? [])]
  if (opts.sample) notes.push(SAMPLE_NOTE)
  const body = { data, asOf: opts.asOf ?? new Date().toISOString(), source: opts.source, notes }
  return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 1) }] }
}

export function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}
