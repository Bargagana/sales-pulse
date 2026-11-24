import type { SalesRow } from '@core/types'
import { UNMAPPED } from '@core/types'
import { CATEGORICAL, CATEGORICAL_LABEL, DELTA_TEXT, DIVERGING, OTHER_COLOR, readableOn, SEQUENTIAL, ink, type SequentialStep } from './tokens'

export interface CategoricalScale {
  /** Names that own a palette slot, in slot order. */
  domain: readonly string[]
  /** Fill colour for a name. Names outside the domain (Unmapped, Other, a 9th entity) get the neutral grey. */
  color(name: string): string
  /** Text colour for a label drawn inside that fill. */
  labelColor(name: string): string
  /** Colours for a list of names, in that list's order: pass straight to Apex `colors` for the same series order. */
  colors(names: readonly string[]): string[]
}

// Plain code-unit comparison: localeCompare can differ between a Mac and a phone, and the whole point
// is that every device paints "Jawa Barat" the same colour.
function byName(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Stable colour per entity: slots are assigned by sorted name, so the colour depends on the name and the
 * domain only, never on rank or on the active filters. Build it from the full, unfiltered dataset; a filter
 * that hides some regions must not repaint the ones left.
 */
export function categoricalScale(names: Iterable<string>): CategoricalScale {
  const unique = [...new Set(names)].filter((n) => n !== '' && n !== UNMAPPED)
  const domain = unique.sort(byName).slice(0, CATEGORICAL.length)
  const slot = new Map(domain.map((name, i) => [name, i]))

  const color = (name: string) => {
    const i = slot.get(name)
    return i === undefined ? OTHER_COLOR : CATEGORICAL[i]!
  }
  const labelColor = (name: string) => {
    const i = slot.get(name)
    return i === undefined ? readableOn(OTHER_COLOR) : CATEGORICAL_LABEL[i]!
  }
  return { domain, color, labelColor, colors: (list) => list.map(color) }
}

/** Top `limit` values of `key` by total net sales: decides who gets a slot when there are more than 8. */
function topByNet(rows: readonly SalesRow[], key: 'region' | 'brand' | 'outlet_type', limit: number): string[] {
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row[key], (totals.get(row[key]) ?? 0) + row.net_sales_idr)
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))
    .slice(0, limit)
    .map(([name]) => name)
}

export interface DatasetScales {
  region: CategoricalScale
  brand: CategoricalScale
  outletType: CategoricalScale
}

/**
 * The three colour keys of the dashboard, computed once per dataset (memoise on dataset.id).
 * With more than 8 entities the 8 largest by net sales keep a colour; the rest fold to grey "Other".
 */
export function datasetScales(rows: readonly SalesRow[]): DatasetScales {
  const limit = CATEGORICAL.length
  return {
    region: categoricalScale(topByNet(rows, 'region', limit)),
    brand: categoricalScale(topByNet(rows, 'brand', limit)),
    outletType: categoricalScale(topByNet(rows, 'outlet_type', limit)),
  }
}

// ---------- sequential (heatmap) ----------

const HEATMAP_STEPS: SequentialStep[] = [100, 200, 300, 400, 500, 600, 700]

/** White text from step 500 up (>= 5.4:1), dark ink at 400 and below (>= 4.8:1). */
export function sequentialLabelColor(step: SequentialStep): string {
  return step >= 500 ? '#ffffff' : ink.primary
}

export interface HeatmapRange {
  from: number
  to: number
  color: string
  foreColor: string
}

/**
 * Apex `plotOptions.heatmap.colorScale.ranges`: zero-or-less in neutral grey ("no sales" must not look
 * like "a little"), then 7 equal-width blue bins up to `max`.
 */
export function heatmapRanges(max: number): HeatmapRange[] {
  const zero: HeatmapRange = { from: Number.MIN_SAFE_INTEGER, to: 0, color: ink.muted, foreColor: ink.secondary }
  if (!(max > 0)) return [zero]
  const width = max / HEATMAP_STEPS.length
  const bins = HEATMAP_STEPS.map((step, i) => ({
    from: i === 0 ? Number.EPSILON : width * i,
    to: i === HEATMAP_STEPS.length - 1 ? Number.MAX_SAFE_INTEGER : width * (i + 1),
    color: SEQUENTIAL[step],
    foreColor: sequentialLabelColor(step),
  }))
  return [zero, ...bins]
}

/** Continuous lookup for one value, using the same bins as heatmapRanges. */
export function sequentialColor(value: number, max: number): string {
  const range = heatmapRanges(max).find((r) => value >= r.from && value <= r.to)
  return range?.color ?? ink.muted
}

// ---------- diverging and deltas ----------

export type DeltaTone = 'positive' | 'negative' | 'neutral'

/**
 * Tone of a change. `positiveIsGood: false` is for metrics where up is bad (returns): the arrow still
 * follows the sign, only the colour flips.
 */
export function deltaTone(value: number | null | undefined, opts: { positiveIsGood?: boolean } = {}): DeltaTone {
  if (value == null || !Number.isFinite(value) || value === 0) return 'neutral'
  const good = opts.positiveIsGood ?? true
  return value > 0 === good ? 'positive' : 'negative'
}

export function deltaTextColor(tone: DeltaTone): string {
  return DELTA_TEXT[tone]
}

/** Bar fill for a change vs. baseline: blue for growth, red for decline, grey for none. */
export function changeColor(change: number): string {
  if (change > 0) return DIVERGING.growth
  if (change < 0) return DIVERGING.decline
  return DIVERGING.neutral
}
