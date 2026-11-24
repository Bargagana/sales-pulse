// PRD §6.4 metric definitions. Every function takes already-filtered rows, so all metrics follow the active filters.
import type { Breakdown, Filters, Kpis, Periods, SalesRow, WeakMode, WeakOutlet } from './types'
import { compareText, Counter, groupBy, median } from './util'
import { daysInMonth, pad2 } from './values'

const sumNet = (rows: SalesRow[]) => rows.reduce((total, r) => total + r.net_sales_idr, 0)
const monthOf = (date: string) => date.slice(0, 7)
const dayOf = (date: string) => Number(date.slice(8, 10))

function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return m === 1 ? `${year - 1}-12` : `${year}-${pad2(m - 1)}`
}

export function applyFilters(rows: SalesRow[], filters: Filters): SalesRow[] {
  const sets = {
    region: filters.regions?.length ? new Set(filters.regions) : null,
    branch: filters.branches?.length ? new Set(filters.branches) : null,
    brand: filters.brands?.length ? new Set(filters.brands) : null,
    outlet_type: filters.outletTypes?.length ? new Set(filters.outletTypes) : null,
    salesman: filters.salesmen?.length ? new Set(filters.salesmen) : null,
    sku: filters.skus?.length ? new Set(filters.skus) : null,
    outlet_id: filters.outletIds?.length ? new Set(filters.outletIds) : null,
  }
  return rows.filter(
    (r) =>
      (!filters.dateFrom || r.date >= filters.dateFrom) &&
      (!filters.dateTo || r.date <= filters.dateTo) &&
      (!sets.region || sets.region.has(r.region)) &&
      (!sets.branch || sets.branch.has(r.branch)) &&
      (!sets.brand || sets.brand.has(r.brand)) &&
      (!sets.outlet_type || sets.outlet_type.has(r.outlet_type)) &&
      (!sets.salesman || sets.salesman.has(r.salesman)) &&
      (!sets.sku || sets.sku.has(r.sku)) &&
      (!sets.outlet_id || sets.outlet_id.has(r.outlet_id)),
  )
}

export function computePeriods(rows: SalesRow[]): Periods {
  if (rows.length === 0) return { from: '', to: '', current: null, baseline: null, comparableDay: null }
  let from = rows[0]!.date
  let to = from
  for (const { date } of rows) {
    if (date < from) from = date
    if (date > to) to = date
  }
  const current = monthOf(to)
  const previous = previousMonth(current)
  const baseline = rows.some((r) => monthOf(r.date) === previous) ? previous : null
  const [year, month] = current.split('-').map(Number) as [number, number]
  const lastDay = dayOf(to)
  return { from, to, current, baseline, comparableDay: lastDay < daysInMonth(year, month) ? lastDay : null }
}

/** Which comparison window a row falls in: day 1..comparableDay of the current or baseline month. */
function windowOf(row: SalesRow, periods: Periods): 'current' | 'baseline' | null {
  if (periods.comparableDay !== null && dayOf(row.date) > periods.comparableDay) return null
  const month = monthOf(row.date)
  if (month === periods.current) return 'current'
  if (month === periods.baseline) return 'baseline'
  return null
}

/** Rows of the current and baseline comparison windows, for MoM of any measure (invoices, outlets, returns). */
export function comparisonWindows(rows: readonly SalesRow[], periods: Periods): { current: SalesRow[]; baseline: SalesRow[] } {
  const windows: { current: SalesRow[]; baseline: SalesRow[] } = { current: [], baseline: [] }
  for (const row of rows) {
    const window = windowOf(row, periods)
    if (window) windows[window].push(row)
  }
  return windows
}

function periodNets(rows: SalesRow[], periods: Periods): { current: number; baseline: number } {
  const nets = { current: 0, baseline: 0 }
  for (const row of rows) {
    const window = windowOf(row, periods)
    if (window) nets[window] += row.net_sales_idr
  }
  return nets
}

const momPct = (current: number, baseline: number) => ((current - baseline) / baseline) * 100

export function computeKpis(rows: SalesRow[]): Kpis {
  const periods = computePeriods(rows)
  const nets = periodNets(rows, periods)
  const returns = rows.filter((r) => r.isReturn)
  const currentNet = periods.current ? nets.current : null
  const baselineNet = periods.baseline ? nets.baseline : null
  return {
    netSales: sumNet(rows),
    grossSales: rows.reduce((total, r) => total + r.gross_sales_idr, 0),
    discount: rows.reduce((total, r) => total + r.discount_idr, 0),
    invoices: new Set(rows.map((r) => r.invoice_no).filter(Boolean)).size,
    activeOutlets: new Set(rows.map((r) => r.outlet_id)).size,
    returnLines: returns.length,
    returnNet: sumNet(returns),
    currentNet,
    baselineNet,
    momPct: currentNet !== null && baselineNet !== null && baselineNet > 0 ? momPct(currentNet, baselineNet) : null,
  }
}

/**
 * MoM % per group (e.g. per region), using the periods of all `rows`: a region with no sales in the current month
 * shows -100% instead of silently comparing its own last two months. momPct is null when the baseline is not positive.
 */
export function momByGroup(rows: SalesRow[], key: keyof SalesRow): { key: string; current: number; baseline: number; momPct: number | null }[] {
  const periods = computePeriods(rows)
  return [...groupBy(rows, (r) => String(r[key]))].map(([k, groupRows]) => {
    const nets = periodNets(groupRows, periods)
    return { key: k, ...nets, momPct: periods.baseline && nets.baseline > 0 ? momPct(nets.current, nets.baseline) : null }
  })
}

function sumBy(rows: SalesRow[], key: keyof SalesRow): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const k = String(row[key])
    totals.set(k, (totals.get(k) ?? 0) + row.net_sales_idr)
  }
  return totals
}

const byNetDesc = (a: [string, number], b: [string, number]) => b[1] - a[1] || compareText(a[0], b[0])

/** Sum net by a column, sorted desc by net. */
export function breakdown(rows: SalesRow[], key: keyof SalesRow): Breakdown[] {
  const total = sumNet(rows)
  return [...sumBy(rows, key)].sort(byNetDesc).map(([k, net]) => ({ key: k, net, share: total === 0 ? 0 : net / total }))
}

/** Heatmap: rowKey x colKey -> net. Rows/cols sorted by total desc. */
export function matrix(rows: SalesRow[], rowKey: keyof SalesRow, colKey: keyof SalesRow): { rows: string[]; cols: string[]; values: number[][] } {
  const rowNames = [...sumBy(rows, rowKey)].sort(byNetDesc).map(([k]) => k)
  const colNames = [...sumBy(rows, colKey)].sort(byNetDesc).map(([k]) => k)
  const rowIndex = new Map(rowNames.map((k, i) => [k, i]))
  const colIndex = new Map(colNames.map((k, i) => [k, i]))
  const values = rowNames.map(() => colNames.map(() => 0))
  for (const row of rows) {
    values[rowIndex.get(String(row[rowKey]))!]![colIndex.get(String(row[colKey]))!]! += row.net_sales_idr
  }
  return { rows: rowNames, cols: colNames, values }
}

/** Daily net series, every date between first and last date present (missing days = 0). */
export function dailySeries(rows: SalesRow[]): { date: string; net: number }[] {
  if (rows.length === 0) return []
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row.date, (totals.get(row.date) ?? 0) + row.net_sales_idr)
  const { from, to } = computePeriods(rows)
  const series: { date: string; net: number }[] = []
  // Walk in UTC so a daylight-saving change in the viewer's timezone cannot skip or repeat a day.
  for (let t = Date.parse(`${from}T00:00:00Z`); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10)
    if (date > to) break
    series.push({ date, net: totals.get(date) ?? 0 })
  }
  return series
}

/** Net per month for sparklines, every month between the first and last present (missing months = 0). */
export function monthlySeries(rows: SalesRow[]): { month: string; net: number }[] {
  if (rows.length === 0) return []
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(monthOf(row.date), (totals.get(monthOf(row.date)) ?? 0) + row.net_sales_idr)
  const { from, to } = computePeriods(rows)
  const series: { month: string; net: number }[] = []
  for (let month = monthOf(to); month >= monthOf(from); month = previousMonth(month)) {
    series.unshift({ month, net: totals.get(month) ?? 0 })
  }
  return series
}

interface OutletStats {
  outletId: string
  name: string
  outletType: string
  branch: string
  region: string
  salesman: string
  net: number
  baseline: number
  current: number
}

/** Per-outlet totals and descriptive attributes (most frequent value across its rows, first seen on a tie). */
function outletStats(rows: SalesRow[], periods: Periods): OutletStats[] {
  const mode = (outletRows: SalesRow[], key: 'outlet_name' | 'outlet_type' | 'branch' | 'region' | 'salesman') => {
    const counter = new Counter<string>()
    for (const r of outletRows) counter.add(r[key])
    return counter.mostFrequent() ?? ''
  }
  return [...groupBy(rows, (r) => r.outlet_id)].map(([outletId, outletRows]) => ({
    outletId,
    name: mode(outletRows, 'outlet_name'),
    outletType: mode(outletRows, 'outlet_type'),
    branch: mode(outletRows, 'branch'),
    region: mode(outletRows, 'region'),
    salesman: mode(outletRows, 'salesman'),
    net: sumNet(outletRows),
    ...periodNets(outletRows, periods),
  }))
}

/** Median MoM % per outlet type over eligible outlets (baseline > 0). */
function peerMedians(eligible: (OutletStats & { momPct: number })[]): Map<string, number> {
  const byType = groupBy(eligible, (o) => o.outletType)
  return new Map([...byType].map(([type, outlets]) => [type, median(outlets.map((o) => o.momPct))]))
}

function toWeakOutlet(o: OutletStats, momPctValue: number, peerMedianPct: number, score: number): WeakOutlet {
  return {
    outletId: o.outletId,
    name: o.name,
    outletType: o.outletType,
    branch: o.branch,
    region: o.region,
    salesman: o.salesman,
    baseline: o.baseline,
    current: o.current,
    change: o.current - o.baseline,
    momPct: momPctValue,
    peerMedianPct,
    score,
  }
}

/**
 * PRD §6.4. "decline": MoM % minus the median MoM % of the same outlet type; needs a baseline month, else [].
 * "lowest": total net in `rows` divided by the median total net of the same outlet type; works with one month.
 * In lowest mode momPct and peerMedianPct are 0 for outlets without a baseline (the type has no "not applicable").
 */
export function weakestOutlets(rows: SalesRow[], opts: { mode?: WeakMode; limit?: number } = {}): WeakOutlet[] {
  const mode = opts.mode ?? 'decline'
  const limit = opts.limit ?? 5
  const periods = computePeriods(rows)
  const stats = outletStats(rows, periods)

  // Lapsed outlets (current = 0) land on -100% naturally; outlets without baseline sales are "new" and not eligible.
  const eligible = stats.filter((o) => o.baseline > 0).map((o) => ({ ...o, momPct: momPct(o.current, o.baseline) }))
  const medians = peerMedians(eligible)
  const momById = new Map(eligible.map((o) => [o.outletId, o.momPct]))

  let ranked: WeakOutlet[]
  if (mode === 'decline') {
    if (!periods.baseline) return []
    ranked = eligible
      .map((o) => toWeakOutlet(o, o.momPct, medians.get(o.outletType)!, o.momPct - medians.get(o.outletType)!))
      .sort((a, b) => a.score - b.score || a.current - b.current || compareText(a.outletId, b.outletId))
  } else {
    const netMedians = new Map([...groupBy(stats, (o) => o.outletType)].map(([type, outlets]) => [type, median(outlets.map((o) => o.net))]))
    ranked = stats
      .map((o) => {
        const typeMedian = netMedians.get(o.outletType)!
        const ratio = typeMedian > 0 ? o.net / typeMedian : 0
        return { weak: toWeakOutlet(o, momById.get(o.outletId) ?? 0, medians.get(o.outletType) ?? 0, ratio), net: o.net }
      })
      .sort((a, b) => a.weak.score - b.weak.score || a.net - b.net || compareText(a.weak.outletId, b.weak.outletId))
      .map((x) => x.weak)
  }
  return ranked.slice(0, limit)
}

/** Outlets with sales in the current period but none in the baseline (same comparison window as weakestOutlets). */
export function newOutlets(rows: SalesRow[]): { outletId: string; name: string }[] {
  const periods = computePeriods(rows)
  if (!periods.baseline) return []
  return outletStats(rows, periods)
    .filter((o) => o.current > 0 && o.baseline <= 0)
    .map((o) => ({ outletId: o.outletId, name: o.name }))
    .sort((a, b) => compareText(a.outletId, b.outletId))
}
