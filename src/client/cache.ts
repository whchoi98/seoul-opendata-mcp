export class TtlCache {
  private store = new Map<string, { value: any; expiresAt: number }>()
  constructor(private now: () => number = Date.now) {}

  get(key: string): any | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expiresAt < this.now()) { this.store.delete(key); return undefined }
    return hit.value
  }

  set(key: string, value: any, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs })
  }
}
