import type { DataProfile, RawTable } from '@core/types'

export interface Upload {
  raw: RawTable
  profile: DataProfile
  createdAt: number
}

const MAX_UPLOADS = 5
const TTL_MS = 60 * 60 * 1000

/** Parsed uploads waiting for propose/apply. In memory only: a restart simply asks the user to upload again. */
export class UploadStore {
  private uploads = new Map<string, Upload>()

  constructor(private now: () => Date) {}

  add(id: string, raw: RawTable, profile: DataProfile): void {
    this.evictExpired()
    // Map preserves insertion order, so the first key is the oldest upload.
    while (this.uploads.size >= MAX_UPLOADS) {
      const oldest = this.uploads.keys().next().value
      if (oldest === undefined) break
      this.uploads.delete(oldest)
    }
    this.uploads.set(id, { raw, profile, createdAt: this.now().getTime() })
  }

  get(id: string): Upload | undefined {
    this.evictExpired()
    return this.uploads.get(id)
  }

  private evictExpired(): void {
    const cutoff = this.now().getTime() - TTL_MS
    for (const [id, upload] of this.uploads) {
      if (upload.createdAt < cutoff) this.uploads.delete(id)
    }
  }
}
