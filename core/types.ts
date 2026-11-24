// Shared domain types. CONTRACT: changing a shape here is an orchestrator/integrator decision.

export const CANONICAL_COLUMNS = [
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
export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number]

export const REQUIRED_COLUMNS = ['date', 'region', 'outlet_id', 'brand', 'net_sales_idr'] as const satisfies readonly CanonicalColumn[]

export const NUMERIC_COLUMNS = ['qty_carton', 'price_per_carton_idr', 'gross_sales_idr', 'discount_idr', 'net_sales_idr'] as const satisfies readonly CanonicalColumn[]

/** Text columns whose values the LLM may normalise via valueMap. */
export const MAPPABLE_COLUMNS = ['region', 'branch', 'outlet_type', 'brand', 'sku', 'salesman'] as const satisfies readonly CanonicalColumn[]
export type MappableColumn = (typeof MAPPABLE_COLUMNS)[number]

export type Lang = 'id' | 'en'

export const UNASSIGNED_SALESMAN = 'Unassigned'
export const UNMAPPED = 'Unmapped'

// ---------- Parsing ----------

export interface RawTable {
  headers: string[]
  rows: string[][]
  delimiter: ',' | ';' | '\t'
}

/** What we send to the LLM. Never the full dataset. */
export interface DataProfile {
  headers: string[]
  sampleRows: string[][] // max 5
  rowCount: number
  /** Per RAW header: distinct trimmed values with counts, capped at 300, only for non-numeric-looking columns. */
  distinctValues: Record<string, { value: string; count: number }[]>
}

export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'MM/DD/YYYY'
export type NumberFormat = 'plain' | 'id' | 'en' // id: 1.234.567,5  en: 1,234,567.5

export interface GeoPoint {
  lat: number
  lon: number
}

/** Proposed by the LLM (or core heuristics), reviewed by the user, applied deterministically by core. */
export interface Mapping {
  /** RAW header -> canonical column, or null to ignore the column. */
  columnMap: Record<string, CanonicalColumn | null>
  dateFormat: DateFormat
  numberFormat: NumberFormat
  /** Per canonical column: trimmed raw value -> canonical value. Values not listed are kept as-is. */
  valueMap: Partial<Record<MappableColumn, Record<string, string>>>
  /** Coordinates for branches missing from core's built-in table. */
  branchGeo: Record<string, GeoPoint>
  notes: string[]
}

// ---------- Clean data ----------

export interface SalesRow {
  date: string // YYYY-MM-DD
  invoice_no: string
  region: string
  branch: string
  outlet_id: string
  outlet_name: string // display name: most frequent trimmed name for this outlet_id
  outlet_type: string
  salesman: string // UNASSIGNED_SALESMAN when blank
  brand: string
  sku: string
  qty_carton: number
  price_per_carton_idr: number
  gross_sales_idr: number
  discount_idr: number
  net_sales_idr: number
  isReturn: boolean // qty_carton < 0 or invoice_no starts with RTR
}
// Optional columns missing from the input: text -> '', numbers -> 0, and the column is absent from Dataset.presentColumns.

export interface QualityReport {
  rowsRead: number
  rowsClean: number
  duplicatesRemoved: number
  duplicateRowNumbers: number[] // 1-based data row numbers (header excluded) of the dropped copies
  valuesTrimmed: number
  valuesFixed: { column: MappableColumn; from: string; to: string; count: number }[]
  returnLines: number
  returnNet: number // sum of net_sales_idr of return lines (negative)
  sharedOutletNames: { name: string; outletIds: string[] }[]
  outletIdsWithNameVariants: { outletId: string; names: string[] }[]
  missingSalesman: number
  arithmeticMismatches: { row: number; reason: 'gross' | 'net' }[]
  unmapped: { column: MappableColumn; value: string; count: number }[]
  unparseable: { row: number; column: CanonicalColumn; value: string }[] // rows with unparseable required values are dropped and listed here
  missingColumns: CanonicalColumn[] // optional canonical columns not present
}

export interface Dataset {
  id: string
  createdAt: string // ISO
  rows: SalesRow[]
  quality: QualityReport
  presentColumns: CanonicalColumn[]
  mapping: Mapping
  /** Built-in coordinates merged with mapping.branchGeo, keyed by canonical branch name. */
  branchGeo: Record<string, GeoPoint>
}

// ---------- Metrics ----------

export interface Filters {
  dateFrom?: string // inclusive YYYY-MM-DD
  dateTo?: string // inclusive YYYY-MM-DD
  regions?: string[]
  branches?: string[]
  brands?: string[]
  outletTypes?: string[]
  salesmen?: string[]
  /** Set by chart clicks only (SKU treemap, outlet-change bars); the filter bar has no picker for them. */
  skus?: string[]
  outletIds?: string[]
}

export interface Periods {
  from: string // first date in rows
  to: string // last date in rows
  current: string | null // YYYY-MM, latest calendar month in rows
  baseline: string | null // YYYY-MM, month before current (null if no data for it)
  /** When the current month is incomplete: compare day 1..comparableDay of both months. null = full months. */
  comparableDay: number | null
}

export interface Kpis {
  netSales: number
  grossSales: number
  discount: number
  invoices: number
  activeOutlets: number
  returnLines: number
  returnNet: number
  currentNet: number | null
  baselineNet: number | null
  momPct: number | null
}

export interface Breakdown {
  key: string
  net: number
  share: number // 0..1 of total net in the input rows
}

export interface WeakOutlet {
  outletId: string
  name: string
  outletType: string
  branch: string
  region: string
  salesman: string // most frequent salesman for this outlet
  baseline: number
  current: number
  change: number // current - baseline (IDR)
  momPct: number // -100 when lapsed
  peerMedianPct: number // median momPct of eligible outlets with same outletType
  score: number // decline mode: momPct - peerMedianPct; lowest mode: net / median net of type
}

export type WeakMode = 'decline' | 'lowest'

// ---------- Summary ----------

/** pct = signed change ("+3,6%"); share = unsigned part of a total ("42,9%"). */
export type FactKind = 'idr' | 'pct' | 'share' | 'int' | 'text' | 'month'

export interface Fact {
  value: number | string
  kind: FactKind
  description: string // English, for the LLM prompt
}

/** Placeholder key -> fact. Keys are [a-z0-9_]+ e.g. total_net, mom_pct, weak_1_name. */
export type Facts = Record<string, Fact>

export interface SummaryScope {
  region?: string // undefined = national
}

export interface SummaryValidation {
  ok: boolean
  errors: string[]
}
