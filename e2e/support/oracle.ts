// Independent re-implementation of PRD §6.3/§6.4 used to check the app's numbers. It deliberately imports nothing
// from core/: if both had the same bug, comparing them would prove nothing.
import { readFileSync } from 'node:fs'

export interface Row {
  date: string
  invoice_no: string
  region: string
  branch: string
  outlet_id: string
  outlet_name: string
  outlet_type: string
  salesman: string
  brand: string
  sku: string
  qty: number
  price: number
  gross: number
  discount: number
  net: number
}

export const HEADERS = [
  'date',
  'invoice_no',
  'region',
  'branch',
  'outlet_id',
  'outlet_name',
  'outlet_type',
  'salesman',
  'brand',
  'sku',
  'qty_carton',
  'price_per_carton_idr',
  'gross_sales_idr',
  'discount_idr',
  'net_sales_idr',
] as const

/** The six regions of the sample, and the one abbreviation it uses. Case and spacing variants fold onto these. */
const REGIONS = ['Jabodetabek', 'Jawa Barat', 'Jawa Tengah', 'Jawa Timur', 'Kalimantan', 'Sumatera']
const REGION_ALIASES: Record<string, string> = { jabar: 'Jawa Barat' }
const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function canonicalRegion(raw: string): string {
  const key = fold(raw)
  return REGION_ALIASES[key.replace(/\s/g, '')] ?? REGIONS.find((r) => r.toLowerCase() === key) ?? raw.trim()
}

/** Raw sample lines as string cells (the sample has no quoted fields, which this checks). */
export function readSampleTable(path = 'data/data.csv'): string[][] {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  if (text.includes('"')) throw new Error('oracle: the sample is expected to have no quoted fields')
  const lines = text.split(/\r?\n/).filter((l) => l !== '')
  const header = lines[0]!.split(',')
  if (header.join(',') !== HEADERS.join(',')) throw new Error('oracle: unexpected sample header')
  return lines.slice(1).map((l) => l.split(','))
}

export function rowFromCells(cells: string[]): Row {
  const c = cells.map((v) => v.trim())
  return {
    date: c[0]!,
    invoice_no: c[1]!,
    region: canonicalRegion(c[2]!),
    branch: c[3]!,
    outlet_id: c[4]!,
    outlet_name: c[5]!,
    outlet_type: c[6]!,
    salesman: c[7] || 'Unassigned',
    brand: c[8]!,
    sku: c[9]!,
    qty: Number(c[10]),
    price: Number(c[11]),
    gross: Number(c[12]),
    discount: Number(c[13]),
    net: Number(c[14]),
  }
}

const rowKey = (r: Row) =>
  [r.date, r.invoice_no, r.region, r.branch, r.outlet_id, r.outlet_name, r.outlet_type, r.salesman, r.brand, r.sku, r.qty, r.price, r.gross, r.discount, r.net].join('\u0001')

/** Clean = canonical rows with exact duplicates (after trimming and mapping) dropped; first copy kept. */
export function clean(table: string[][]): { rows: Row[]; duplicateRowNumbers: number[] } {
  const seen = new Set<string>()
  const rows: Row[] = []
  const duplicateRowNumbers: number[] = []
  table.forEach((cells, i) => {
    const row = rowFromCells(cells)
    const key = rowKey(row)
    if (seen.has(key)) duplicateRowNumbers.push(i + 1)
    else {
      seen.add(key)
      rows.push(row)
    }
  })
  return { rows, duplicateRowNumbers }
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const isReturn = (r: Row) => r.qty < 0 || r.invoice_no.toUpperCase().startsWith('RTR')

export function totals(rows: Row[]) {
  const returns = rows.filter(isReturn)
  return {
    net: sum(rows.map((r) => r.net)),
    gross: sum(rows.map((r) => r.gross)),
    discount: sum(rows.map((r) => r.discount)),
    invoices: new Set(rows.map((r) => r.invoice_no)).size,
    outlets: new Set(rows.map((r) => r.outlet_id)).size,
    returnLines: returns.length,
    returnNet: sum(returns.map((r) => r.net)),
  }
}

export function netBy(rows: Row[], key: (r: Row) => string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + r.net)
  return out
}

// ---------- periods (PRD §6.4) ----------

const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()
function previousMonth(ym: string): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export interface OraclePeriods {
  from: string
  to: string
  current: string | null
  baseline: string | null
  comparableDay: number | null
}

export function periods(rows: Row[]): OraclePeriods {
  const dates = rows.map((r) => r.date).sort()
  if (dates.length === 0) return { from: '', to: '', current: null, baseline: null, comparableDay: null }
  const to = dates.at(-1)!
  const current = to.slice(0, 7)
  const prev = previousMonth(current)
  const baseline = rows.some((r) => r.date.startsWith(prev)) ? prev : null
  const day = Number(to.slice(8, 10))
  return { from: dates[0]!, to, current, baseline, comparableDay: day < daysInMonth(current) ? day : null }
}

const inWindow = (r: Row, month: string, day: number | null) => r.date.startsWith(month) && (day === null || Number(r.date.slice(8, 10)) <= day)

export function mom(rows: Row[]): { current: number; baseline: number | null; pct: number | null } {
  const p = periods(rows)
  const current = sum(rows.filter((r) => p.current && inWindow(r, p.current, p.comparableDay)).map((r) => r.net))
  if (!p.baseline) return { current, baseline: null, pct: null }
  const baseline = sum(rows.filter((r) => inWindow(r, p.baseline!, p.comparableDay)).map((r) => r.net))
  return { current, baseline, pct: baseline === 0 ? null : ((current - baseline) / baseline) * 100 }
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
}

export interface OracleOutlet {
  outletId: string
  name: string
  outletType: string
  baseline: number
  current: number
  momPct: number
  peerMedianPct: number
  score: number
}

/** Default view: outlet MoM % minus the median MoM % of its outlet type; eligible = baseline > 0. */
export function weakestDecline(rows: Row[], limit = 5): { outlets: OracleOutlet[]; newOutletIds: string[]; peerMedians: Map<string, number> } {
  const p = periods(rows)
  if (!p.current || !p.baseline) return { outlets: [], newOutletIds: [], peerMedians: new Map() }
  const byOutlet = new Map<string, Row[]>()
  for (const r of rows) byOutlet.set(r.outlet_id, [...(byOutlet.get(r.outlet_id) ?? []), r])

  const eligible: Omit<OracleOutlet, 'peerMedianPct' | 'score'>[] = []
  const newOutletIds: string[] = []
  for (const [id, outletRows] of byOutlet) {
    const baseline = sum(outletRows.filter((r) => inWindow(r, p.baseline!, p.comparableDay)).map((r) => r.net))
    const current = sum(outletRows.filter((r) => inWindow(r, p.current!, p.comparableDay)).map((r) => r.net))
    if (baseline > 0) {
      eligible.push({
        outletId: id,
        name: mostFrequent(outletRows.map((r) => r.outlet_name)),
        outletType: mostFrequent(outletRows.map((r) => r.outlet_type)),
        baseline,
        current,
        momPct: ((current - baseline) / baseline) * 100,
      })
    } else if (current !== 0 && !outletRows.some((r) => r.date.startsWith(p.baseline!))) newOutletIds.push(id)
  }

  const peerMedians = new Map<string, number>()
  for (const type of new Set(eligible.map((o) => o.outletType))) {
    peerMedians.set(type, median(eligible.filter((o) => o.outletType === type).map((o) => o.momPct)))
  }
  const scored = eligible.map((o) => {
    const peer = peerMedians.get(o.outletType)!
    return { ...o, peerMedianPct: peer, score: o.momPct - peer }
  })
  // PRD tie-break is lower current sales; it says nothing after that (two lapsed outlets of one type tie on both),
  // so ties fall back to the outlet id, as the app does.
  scored.sort((a, b) => a.score - b.score || a.current - b.current || a.outletId.localeCompare(b.outletId))
  return { outlets: scored.slice(0, limit), newOutletIds: newOutletIds.sort(), peerMedians }
}

/** Alternative view: outlet net over the rows in scope divided by the median outlet net of its type. */
export function weakestLowest(rows: Row[], limit = 5): { outletId: string; name: string; net: number; score: number }[] {
  const net = netBy(rows, (r) => r.outlet_id)
  const names = new Map<string, string[]>()
  for (const r of rows) names.set(r.outlet_id, [...(names.get(r.outlet_id) ?? []), r.outlet_name])
  const typeOf = new Map<string, string>()
  for (const r of rows) typeOf.set(r.outlet_id, r.outlet_type)
  const medians = new Map<string, number>()
  for (const type of new Set(typeOf.values())) {
    medians.set(type, median([...net].filter(([id]) => typeOf.get(id) === type).map(([, v]) => v)))
  }
  return [...net]
    .map(([outletId, v]) => ({ outletId, name: mostFrequent(names.get(outletId)!), net: v, score: v / medians.get(typeOf.get(outletId)!)! }))
    .sort((a, b) => a.score - b.score || a.net - b.net || a.outletId.localeCompare(b.outletId))
    .slice(0, limit)
}

// ---------- filters ----------

export interface OracleFilters {
  dateFrom?: string
  dateTo?: string
  regions?: string[]
  branches?: string[]
  brands?: string[]
  outletTypes?: string[]
  salesmen?: string[]
}

export function applyFilters(rows: Row[], f: OracleFilters): Row[] {
  const has = (list: string[] | undefined, v: string) => !list || list.length === 0 || list.includes(v)
  return rows.filter(
    (r) =>
      (!f.dateFrom || r.date >= f.dateFrom) &&
      (!f.dateTo || r.date <= f.dateTo) &&
      has(f.regions, r.region) &&
      has(f.branches, r.branch) &&
      has(f.brands, r.brand) &&
      has(f.outletTypes, r.outlet_type) &&
      has(f.salesmen, r.salesman),
  )
}

/** MoM % per group, on the comparison windows of all `rows` (a group with no current sales is -100%). */
export function momByGroup(rows: Row[], key: (r: Row) => string): Map<string, number | null> {
  const p = periods(rows)
  const out = new Map<string, number | null>()
  for (const k of new Set(rows.map(key))) {
    const group = rows.filter((r) => key(r) === k)
    const cur = sum(group.filter((r) => p.current && inWindow(r, p.current, p.comparableDay)).map((r) => r.net))
    const base = p.baseline ? sum(group.filter((r) => inWindow(r, p.baseline!, p.comparableDay)).map((r) => r.net)) : 0
    out.set(k, base > 0 ? ((cur - base) / base) * 100 : null)
  }
  return out
}

/** Sorted [key, net] pairs, largest first, for readable diffs in assertions. */
export const ranked = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
