// Everything the dashboard draws, derived from the cleaned rows with core/ (PRD §6.4). Pure, so the tests and the
// components share one code path. Components memoise buildViews on [dataset, filters].
import { applyFilters, breakdown, comparisonWindows, computeKpis, computePeriods, dailySeries, matrix, weakestOutlets } from '@core/index'
import type { Breakdown, Dataset, Filters, Kpis, Periods, SalesRow, WeakOutlet } from '@core/types'
import { datasetScales, type DatasetScales } from '@/theme'
import { filterOptions, without, type FilterOptions } from './filters'

export interface Change {
  current: number
  baseline: number
  /** null when there is no baseline month or the baseline is zero. */
  momPct: number | null
}

export interface KpiView {
  kpis: Kpis
  invoices: Change
  outlets: Change
  /** Absolute return value, so "returns went up" reads as a positive change. */
  returns: Change
  daily: { dates: string[]; net: number[]; invoices: number[]; outlets: number[]; returns: number[] }
}

export type Matrix = ReturnType<typeof matrix>

export interface BranchView extends Breakdown {
  region: string
}

export interface SkuView extends Breakdown {
  brand: string
}

export interface DashboardViews {
  rows: SalesRow[]
  periods: Periods
  kpi: KpiView
  regions: Breakdown[]
  brands: Breakdown[]
  regionBrand: Matrix
  regionOutletType: Matrix
  branches: BranchView[]
  skus: SkuView[]
  daily: { date: string; net: number }[]
  outletChanges: WeakOutlet[]
}

/** Facts about the whole, unfiltered dataset: colour keys, picker options, date bounds. Memoise on dataset.id. */
export interface DatasetIndex {
  scales: DatasetScales
  options: FilterOptions
  periods: Periods
  branchRegion: Map<string, string>
  skuBrand: Map<string, string>
}

/** For each key, the value it appears with most often (a branch's region, a SKU's brand). */
function dominant(rows: readonly SalesRow[], key: 'branch' | 'sku', value: 'region' | 'brand'): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const perKey = counts.get(row[key]) ?? new Map<string, number>()
    perKey.set(row[value], (perKey.get(row[value]) ?? 0) + 1)
    counts.set(row[key], perKey)
  }
  const result = new Map<string, string>()
  for (const [k, perKey] of counts) {
    result.set(k, [...perKey].sort((a, b) => b[1] - a[1])[0]![0])
  }
  return result
}

export function indexDataset(dataset: Dataset): DatasetIndex {
  return {
    scales: datasetScales(dataset.rows),
    options: filterOptions(dataset.rows),
    periods: computePeriods(dataset.rows),
    branchRegion: dominant(dataset.rows, 'branch', 'region'),
    skuBrand: dominant(dataset.rows, 'sku', 'brand'),
  }
}

function change(current: number, baseline: number, hasBaseline: boolean): Change {
  return { current, baseline, momPct: hasBaseline && baseline > 0 ? ((current - baseline) / baseline) * 100 : null }
}

export function kpiView(rows: SalesRow[], periods: Periods): KpiView {
  const kpis = computeKpis(rows)
  const windows = comparisonWindows(rows, periods)
  const now = computeKpis(windows.current)
  const before = computeKpis(windows.baseline)
  const hasBaseline = periods.baseline !== null

  const series = dailySeries(rows)
  const dates = series.map((d) => d.date)
  const position = new Map(dates.map((d, i) => [d, i]))
  const invoiceSets = dates.map(() => new Set<string>())
  const outletSets = dates.map(() => new Set<string>())
  const returns = dates.map(() => 0)
  for (const row of rows) {
    const i = position.get(row.date)!
    if (row.invoice_no) invoiceSets[i]!.add(row.invoice_no)
    outletSets[i]!.add(row.outlet_id)
    if (row.isReturn) returns[i]! += Math.abs(row.net_sales_idr)
  }

  return {
    kpis,
    invoices: change(now.invoices, before.invoices, hasBaseline),
    outlets: change(now.activeOutlets, before.activeOutlets, hasBaseline),
    returns: change(Math.abs(now.returnNet), Math.abs(before.returnNet), hasBaseline),
    daily: {
      dates,
      net: series.map((d) => d.net),
      invoices: invoiceSets.map((s) => s.size),
      outlets: outletSets.map((s) => s.size),
      returns,
    },
  }
}

/** Outlets with the largest Rp change between baseline and current, ordered from biggest fall to biggest rise. */
export function biggestOutletChanges(rows: SalesRow[], limit: number): WeakOutlet[] {
  // weakestOutlets with no limit is every eligible outlet (baseline > 0) with its change; new outlets have no baseline.
  return weakestOutlets(rows, { mode: 'decline', limit: Number.POSITIVE_INFINITY })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit)
    .sort((a, b) => a.change - b.change)
}

export function buildViews(dataset: Dataset, index: DatasetIndex, filters: Filters): DashboardViews {
  const all = dataset.rows
  const rows = applyFilters(all, filters)
  const periods = computePeriods(rows)
  const exceptBrands = applyFilters(all, without(filters, 'brands'))

  return {
    rows,
    periods,
    kpi: kpiView(rows, periods),
    regions: breakdown(applyFilters(all, without(filters, 'regions')), 'region'),
    brands: breakdown(exceptBrands, 'brand'),
    regionBrand: matrix(applyFilters(all, without(filters, 'regions', 'brands')), 'region', 'brand'),
    regionOutletType: matrix(applyFilters(all, without(filters, 'outletTypes')), 'region', 'outlet_type'),
    branches: breakdown(applyFilters(all, without(filters, 'branches')), 'branch').map((b) => ({
      ...b,
      region: index.branchRegion.get(b.key) ?? '',
    })),
    // Each chart ignores the dimension its own clicks set, so the picked tile/bar stays visible next to the rest.
    skus: breakdown(applyFilters(all, without(filters, 'skus')), 'sku').map((s) => ({ ...s, brand: index.skuBrand.get(s.key) ?? '' })),
    daily: dailySeries(rows),
    outletChanges: biggestOutletChanges(applyFilters(all, without(filters, 'outletIds')), 10),
  }
}

/** Keeps the `limit` largest items and sums the rest into one "Other" bucket (null when nothing is left over). */
export function foldTail<T extends Breakdown>(items: readonly T[], limit: number): { top: T[]; other: Breakdown | null } {
  if (items.length <= limit) return { top: [...items], other: null }
  const rest = items.slice(limit)
  return {
    top: items.slice(0, limit),
    other: { key: '', net: rest.reduce((s, i) => s + i.net, 0), share: rest.reduce((s, i) => s + i.share, 0) },
  }
}
