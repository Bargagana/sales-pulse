/** Code-unit string order. Unlike localeCompare it gives the same order in every runtime and locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Counts occurrences, remembering first-seen order (Map iteration order) for tie-breaks. */
export class Counter<K> {
  readonly counts = new Map<K, number>()

  add(key: K, by = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + by)
  }

  /** Highest count wins; ties go to the key seen first. */
  mostFrequent(): K | undefined {
    let best: K | undefined
    let bestCount = -Infinity
    for (const [key, count] of this.counts) {
      if (count > bestCount) {
        best = key
        bestCount = count
      }
    }
    return best
  }
}

/** Rounds half away from zero, so -54.95 and 54.95 round symmetrically (Math.round alone sends -2.5 to -2). */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor
}

/** Groups items by key, keeping first-seen key order. */
export function groupBy<T>(items: Iterable<T>, keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}
