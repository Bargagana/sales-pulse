const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** 32-bit FNV-1a over UTF-16 code units. Pass the previous result as `hash` to hash a stream of strings. */
export function fnv1aUpdate(text: string, hash: number = FNV_OFFSET): number {
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/** 8 hex chars. Not cryptographic: used for cache keys and stable ids. */
export function toHex(hash: number): string {
  return hash.toString(16).padStart(8, '0')
}

export function fnv1a(text: string): string {
  return toHex(fnv1aUpdate(text))
}
