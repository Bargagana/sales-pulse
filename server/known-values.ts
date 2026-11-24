import * as core from '@core/index'
import { MAPPABLE_COLUMNS, type Dataset, type MappableColumn } from '@core/types'
import type { SavedMapping } from './data-store'

/** Canonical values per mappable column of a cleaned dataset. */
export function knownValuesOf(dataset: Dataset): Partial<Record<MappableColumn, string[]>> {
  const known: Partial<Record<MappableColumn, string[]>> = {}
  for (const column of MAPPABLE_COLUMNS) {
    if (dataset.presentColumns.includes(column)) known[column] = [...new Set(dataset.rows.map((row) => row[column]))]
  }
  return known
}

/**
 * Values a push may bring without being flagged: everything the user confirmed in any saved mapping.
 * An exact profile match needs no check at all (same distinct values as when it was confirmed).
 * The active dataset is only a fallback for mappings saved before knownValues existed; using it first would let one
 * pushed variant (whose new names became Unmapped) make the next push of the original file look unknown.
 */
export function confirmedValues(
  profileKey: string,
  saved: Record<string, SavedMapping>,
  active: Dataset | null,
): Partial<Record<MappableColumn, string[]>> | undefined {
  if (saved[profileKey]) return undefined
  const sets: Partial<Record<MappableColumn, Set<string>>> = {}
  let any = false
  for (const entry of Object.values(saved)) {
    for (const column of MAPPABLE_COLUMNS) {
      const values = entry.knownValues?.[column]
      if (!values) continue
      any = true
      const set = (sets[column] ??= new Set())
      for (const v of values) set.add(v)
    }
  }
  if (!any) return active ? knownValuesOf(active) : undefined
  const known: Partial<Record<MappableColumn, string[]>> = {}
  for (const column of MAPPABLE_COLUMNS) {
    const set = sets[column]
    if (set) known[column] = [...set].filter((v) => v !== core.UNMAPPED)
  }
  return known
}
