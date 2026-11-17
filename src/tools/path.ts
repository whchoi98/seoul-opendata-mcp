/** 건너뛰는 경로 자리. 빈 문자열을 넣으면 그 뒤 필터가 모두 무시된다 */
export const BLANK = ' '

/**
 * 열린데이터광장 경로 자리 배열을 만든다. 값이 없는 중간 자리는 BLANK로 채우고, 끝쪽 빈 자리는 보내지 않는다.
 * 예: [undefined, '14'] → [' ', '14'], ['20260731', undefined, undefined] → ['20260731']
 */
export function positionalPath(values: Array<string | undefined>): string[] {
  const path = values.map(v => v?.trim() || BLANK)
  while (path.length > 0 && path[path.length - 1] === BLANK) path.pop()
  return path
}
