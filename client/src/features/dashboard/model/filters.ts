import type { Filters, SalesRow } from '@core/types'

/** The multi-value filters that have a picker in the filter bar. Each one narrows a single SalesRow column. */
export type PickerDimension = 'regions' | 'branches' | 'brands' | 'outletTypes' | 'salesmen'
/** Every multi-value filter: the pickers plus the ones only a chart click sets (SKU tile, outlet bar). */
export type Dimension = PickerDimension | 'skus' | 'outletIds'

export const DIMENSIONS: readonly PickerDimension[] = ['regions', 'branches', 'brands', 'outletTypes', 'salesmen']
export const ALL_DIMENSIONS: readonly Dimension[] = [...DIMENSIONS, 'skus', 'outletIds']

export const DIMENSION_COLUMN = {
  regions: 'region',
  branches: 'branch',
  brands: 'brand',
  outletTypes: 'outlet_type',
  salesmen: 'salesman',
  skus: 'sku',
  outletIds: 'outlet_id',
} as const satisfies Record<Dimension, keyof SalesRow>

export type FilterOptions = Record<PickerDimension, string[]>

/** Sets one dimension, dropping the key when empty so the request body stays minimal. */
export function setDimension(filters: Filters, dim: Dimension, values: readonly string[]): Filters {
  const next: Filters = { ...filters }
  if (values.length > 0) next[dim] = [...values]
  else delete next[dim]
  return next
}

/** Adds the value if absent, removes it if present: the behaviour of every chart click. */
export function toggleValue(filters: Filters, dim: Dimension, value: string): Filters {
  const current = filters[dim] ?? []
  return setDimension(filters, dim, current.includes(value) ? current.filter((v) => v !== value) : [...current, value])
}

export function setDateRange(filters: Filters, dateFrom: string | undefined, dateTo: string | undefined): Filters {
  const next: Filters = { ...filters }
  if (dateFrom) next.dateFrom = dateFrom
  else delete next.dateFrom
  if (dateTo) next.dateTo = dateTo
  else delete next.dateTo
  return next
}

/**
 * Filters for a chart that lets the user pick values of `dims`: those dimensions are left out, so the chart keeps
 * showing every option (the picked one full colour, the rest dimmed) instead of collapsing to the selection.
 */
export function without(filters: Filters, ...dims: Dimension[]): Filters {
  const next: Filters = { ...filters }
  for (const dim of dims) delete next[dim]
  return next
}

/** Number of controls with a value: each dimension counts once, the date range counts once. */
export function activeFilterCount(filters: Filters): number {
  const dims = ALL_DIMENSIONS.filter((dim) => (filters[dim]?.length ?? 0) > 0).length
  return dims + (filters.dateFrom || filters.dateTo ? 1 : 0)
}

/** Distinct values per dimension over the whole dataset, sorted by name for the pickers. */
export function filterOptions(rows: readonly SalesRow[]): FilterOptions {
  const sets = Object.fromEntries(DIMENSIONS.map((dim) => [dim, new Set<string>()])) as Record<Dimension, Set<string>>
  for (const row of rows) {
    for (const dim of DIMENSIONS) {
      const value = row[DIMENSION_COLUMN[dim]]
      if (value) sets[dim].add(value)
    }
  }
  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b))
  return Object.fromEntries(DIMENSIONS.map((dim) => [dim, sorted(sets[dim])])) as FilterOptions
}
