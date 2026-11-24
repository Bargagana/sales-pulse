import { fnv1a } from './hash'
import {
  CANONICAL_COLUMNS,
  MAPPABLE_COLUMNS,
  NUMERIC_COLUMNS,
  REQUIRED_COLUMNS,
  type CanonicalColumn,
  type DataProfile,
  type DateFormat,
  type GeoPoint,
  type MappableColumn,
  type Mapping,
  type NumberFormat,
  type RawTable,
} from './types'
import { compareText, Counter } from './util'

// Limits of mappingSchema (core/schemas.ts): a mapping we produce must survive the round trip through ApplyRequest.
const MAX_NOTES = 50
const MAX_NOTE_LENGTH = 500
const MAX_VALUE_LENGTH = 200
const limitNotes = (notes: string[]) => notes.slice(0, MAX_NOTES).map((n) => n.slice(0, MAX_NOTE_LENGTH))
// No real region, brand or product name contains "<" or ">"; a target that does is markup, e.g. injected through a
// CSV cell into the LLM's proposal. The UI escapes every name anyway; this keeps such a target out of the data.
const isValidTarget = (to: unknown): to is string => typeof to === 'string' && to.trim() !== '' && to.length <= MAX_VALUE_LENGTH && !/[<>]/.test(to)

// ---------- headers ----------

/** "Net Sales (IDR)" -> "netsalesidr": header matching ignores case, spaces, underscores and punctuation. */
const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '')

const HEADER_ALIASES: Record<CanonicalColumn, string[]> = {
  date: ['date', 'tanggal', 'tgl', 'invoice date', 'tanggal invoice', 'tanggal faktur', 'transaction date', 'tanggal transaksi', 'order date'],
  invoice_no: ['invoice no', 'invoice', 'invoice number', 'invoice id', 'no invoice', 'nomor invoice', 'no faktur', 'nomor faktur', 'faktur'],
  region: ['region', 'wilayah', 'area', 'regional', 'daerah'],
  branch: ['branch', 'cabang', 'city', 'kota', 'depo'],
  outlet_id: ['outlet id', 'outlet code', 'kode outlet', 'id outlet', 'customer id', 'customer code', 'kode toko', 'id toko', 'kode pelanggan'],
  outlet_name: ['outlet name', 'outlet', 'nama outlet', 'customer name', 'customer', 'nama toko', 'toko', 'nama pelanggan', 'pelanggan'],
  outlet_type: ['outlet type', 'tipe outlet', 'jenis outlet', 'kategori outlet', 'channel', 'customer type', 'tipe toko', 'jenis toko'],
  salesman: ['salesman', 'salesperson', 'sales rep', 'sales name', 'nama sales', 'nama salesman', 'penjual'],
  brand: ['brand', 'merek', 'merk'],
  sku: ['sku', 'product', 'produk', 'item', 'product name', 'nama produk', 'item name', 'barang', 'nama barang'],
  qty_carton: ['qty carton', 'qty', 'quantity', 'qty karton', 'jumlah karton', 'karton', 'carton', 'cartons', 'kuantitas'],
  price_per_carton_idr: ['price per carton', 'price', 'unit price', 'harga', 'harga per karton', 'harga satuan', 'harga karton'],
  gross_sales_idr: ['gross sales', 'gross', 'gross amount', 'penjualan kotor', 'bruto'],
  discount_idr: ['discount', 'diskon', 'disc', 'potongan'],
  net_sales_idr: ['net sales', 'net', 'net amount', 'nett', 'penjualan bersih', 'netto', 'total bersih'],
}

const COLUMN_BY_HEADER_KEY = new Map<string, CanonicalColumn>()
for (const column of CANONICAL_COLUMNS) {
  for (const alias of [column, ...HEADER_ALIASES[column]]) COLUMN_BY_HEADER_KEY.set(headerKey(alias), column)
}

/** Canonical column for a raw header, also accepting a currency suffix ("Net Sales (Rp)", "Harga IDR"). */
function resolveHeader(header: string): CanonicalColumn | undefined {
  const key = headerKey(header)
  return COLUMN_BY_HEADER_KEY.get(key) ?? COLUMN_BY_HEADER_KEY.get(key.replace(/(idr|rp)$/, ''))
}

function matchColumns(headers: string[]): { columnMap: Mapping['columnMap']; notes: string[] } {
  const columnMap: Mapping['columnMap'] = {}
  const notes: string[] = []
  const taken = new Map<CanonicalColumn, string>()
  for (const header of headers) {
    const column = resolveHeader(header)
    if (!column) {
      columnMap[header] = null
      notes.push(`Column "${header}" was not recognised and is ignored.`)
    } else if (taken.has(column)) {
      columnMap[header] = null
      notes.push(`Column "${header}" also looks like ${column}; using "${taken.get(column)}" and ignoring this one.`)
    } else {
      columnMap[header] = column
      taken.set(column, header)
    }
  }
  return { columnMap, notes }
}

function columnValues(raw: RawTable, mapping: Mapping['columnMap'], column: CanonicalColumn): string[] {
  const index = raw.headers.findIndex((h) => mapping[h] === column)
  if (index === -1) return []
  return raw.rows.map((row) => (row[index] ?? '').trim()).filter((v) => v !== '')
}

// ---------- formats ----------

export function sniffDateFormat(values: string[]): { format: DateFormat; note?: string } {
  let iso = 0
  let dashed = 0
  let slashed = 0
  let firstOver12 = false
  let secondOver12 = false
  for (const value of values) {
    const text = value.replace(/[ T]\d{1,2}:\d{2}.*$/, '')
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) iso++
    else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(text)) dashed++
    else {
      const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec(text)
      if (!m) continue
      slashed++
      if (Number(m[1]) > 12) firstOver12 = true
      if (Number(m[2]) > 12) secondOver12 = true
    }
  }

  if (iso === 0 && dashed === 0 && slashed === 0) {
    return { format: 'YYYY-MM-DD', note: 'Date format not recognised; assumed YYYY-MM-DD. Please check the date column.' }
  }
  if (iso >= dashed && iso >= slashed) return { format: 'YYYY-MM-DD' }
  if (dashed >= slashed) return { format: 'DD-MM-YYYY' }
  if (secondOver12 && !firstOver12) return { format: 'MM/DD/YYYY' }
  if (firstOver12 && !secondOver12) return { format: 'DD/MM/YYYY' }
  return {
    format: 'DD/MM/YYYY',
    note: secondOver12
      ? 'Dates mix day-first and month-first values; assumed DD/MM/YYYY. Rows that do not fit will be reported.'
      : 'Every date has day and month at or below 12, so the order is ambiguous; assumed DD/MM/YYYY (Indonesian convention). Please confirm.',
  }
}

type NumberShape = 'neutral' | 'id' | 'en' | 'dotDecimal' | 'ambiguousDot' | 'ambiguousComma' | 'commaDecimal'

/** What a single value says about the separators in use. "528.000" alone cannot tell 528 from 528000. */
function numberShape(value: string): NumberShape {
  const text = value.replace(/[\s()+-]/g, '').replace(/^(rp\.?|idr)/i, '')
  const dot = text.lastIndexOf('.')
  const comma = text.lastIndexOf(',')
  if (dot === -1 && comma === -1) return 'neutral'
  if (dot !== -1 && comma !== -1) return comma > dot ? 'id' : 'en'
  if (dot !== -1) {
    if (text.indexOf('.') !== dot) return 'id'
    return /\.\d{3}$/.test(text) ? 'ambiguousDot' : 'dotDecimal'
  }
  if (text.indexOf(',') !== comma) return 'en'
  return /,\d{3}$/.test(text) ? 'ambiguousComma' : 'commaDecimal'
}

export function sniffNumberFormat(values: string[]): { format: NumberFormat; note?: string } {
  const shapes = new Counter<NumberShape>()
  for (const value of values) shapes.add(numberShape(value))
  const n = (shape: NumberShape) => shapes.counts.get(shape) ?? 0

  const idVotes = n('id') + n('commaDecimal')
  const enVotes = n('en')
  if (idVotes > 0 && enVotes > 0) {
    const format = idVotes >= enVotes ? 'id' : 'en'
    return { format, note: `Numbers mix Indonesian and English separators; assumed ${format === 'id' ? '1.234,5' : '1,234.5'} style. Values that do not fit will be reported.` }
  }
  if (idVotes > 0) return { format: 'id' }
  if (enVotes > 0) return { format: 'en' }
  if (n('dotDecimal') > 0) return { format: 'plain' }
  if (n('ambiguousDot') > 0) {
    return { format: 'id', note: 'Numbers like "528.000" could be thousands or decimals; assumed Indonesian thousands (528.000 = 528000). Please confirm.' }
  }
  if (n('ambiguousComma') > 0) {
    return { format: 'en', note: 'Numbers like "528,000" could be thousands or decimals; assumed thousands (528,000 = 528000). Please confirm.' }
  }
  return { format: 'plain' }
}

// ---------- values ----------

/** Case and whitespace variants share a fold key: "JAWA  BARAT" and "Jawa Barat" -> "jawa barat". */
const foldKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
const aliasKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Indonesian region abbreviations and English names. Each lists candidate regions, most specific first:
 * the first candidate the dataset already uses wins, so "Sumut" joins "Sumatera" in a dataset with island-level regions.
 */
export const KNOWN_REGION_ALIASES: Record<string, readonly string[]> = {
  jabar: ['Jawa Barat'],
  westjava: ['Jawa Barat'],
  jateng: ['Jawa Tengah'],
  centraljava: ['Jawa Tengah'],
  jatim: ['Jawa Timur'],
  eastjava: ['Jawa Timur'],
  diy: ['DI Yogyakarta', 'Jawa Tengah'],
  jogja: ['DI Yogyakarta', 'Jawa Tengah'],
  yogya: ['DI Yogyakarta', 'Jawa Tengah'],
  dki: ['DKI Jakarta', 'Jabodetabek'],
  dkijakarta: ['DKI Jakarta', 'Jabodetabek'],
  jakarta: ['DKI Jakarta', 'Jabodetabek'],
  jabotabek: ['Jabodetabek'],
  jabodebek: ['Jabodetabek'],
  jadetabek: ['Jabodetabek'],
  greaterjakarta: ['Jabodetabek'],
  sumatra: ['Sumatera'],
  sumut: ['Sumatera Utara', 'Sumatera'],
  sumbar: ['Sumatera Barat', 'Sumatera'],
  sumsel: ['Sumatera Selatan', 'Sumatera'],
  northsumatra: ['Sumatera Utara', 'Sumatera'],
  southsumatra: ['Sumatera Selatan', 'Sumatera'],
  kalbar: ['Kalimantan Barat', 'Kalimantan'],
  kalteng: ['Kalimantan Tengah', 'Kalimantan'],
  kalsel: ['Kalimantan Selatan', 'Kalimantan'],
  kaltim: ['Kalimantan Timur', 'Kalimantan'],
  kaltara: ['Kalimantan Utara', 'Kalimantan'],
  borneo: ['Kalimantan'],
  sulsel: ['Sulawesi Selatan', 'Sulawesi'],
  sulut: ['Sulawesi Utara', 'Sulawesi'],
  sulteng: ['Sulawesi Tengah', 'Sulawesi'],
  sultra: ['Sulawesi Tenggara', 'Sulawesi'],
  ntb: ['Nusa Tenggara Barat'],
  ntt: ['Nusa Tenggara Timur'],
}

const isTitleCase = (value: string) => value.split(' ').every((word) => word === word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())

/** Most frequent spelling; on a tie a Title Case spelling, else the one seen first. */
function preferredSpelling(spellings: Counter<string>): string {
  const max = Math.max(...spellings.counts.values())
  const tied = [...spellings.counts].filter(([, count]) => count === max).map(([value]) => value)
  return tied.find(isTitleCase) ?? tied[0]!
}

function buildValueMap(column: MappableColumn, values: string[], notes: string[]): Record<string, string> {
  const groups = new Map<string, Counter<string>>()
  for (const value of values) {
    const key = foldKey(value)
    if (!groups.has(key)) groups.set(key, new Counter())
    groups.get(key)!.add(value)
  }

  const target = new Map<string, string>() // fold key -> canonical spelling
  for (const [key, spellings] of groups) target.set(key, preferredSpelling(spellings))

  if (column === 'region') {
    for (const key of groups.keys()) {
      const candidates = KNOWN_REGION_ALIASES[aliasKey(key)]
      if (!candidates) continue
      const existing = candidates.find((c) => groups.has(foldKey(c)))
      const resolved = existing ? target.get(foldKey(existing))! : candidates[0]!
      notes.push(`Region "${target.get(key)}" is a known abbreviation of "${resolved}".`)
      target.set(key, resolved)
    }
  }

  const valueMap: Record<string, string> = {}
  for (const [key, spellings] of groups) {
    const to = target.get(key)!
    if (!isValidTarget(to)) continue
    for (const from of spellings.counts.keys()) if (from !== to) valueMap[from] = to
  }
  return valueMap
}

// ---------- public ----------

/** Deterministic best-effort mapping without an LLM. Used as LLM seed, fallback, and in tests. */
export function heuristicMapping(raw: RawTable): Mapping {
  const { columnMap, notes } = matchColumns(raw.headers)

  const missing = REQUIRED_COLUMNS.filter((c) => !Object.values(columnMap).includes(c))
  if (missing.length > 0) notes.push(`Required columns not found: ${missing.join(', ')}. Map them manually.`)

  const date = sniffDateFormat(columnValues(raw, columnMap, 'date'))
  if (date.note) notes.push(date.note)

  const numbers = sniffNumberFormat(NUMERIC_COLUMNS.flatMap((c) => columnValues(raw, columnMap, c)))
  if (numbers.note) notes.push(numbers.note)

  const valueMap: Mapping['valueMap'] = {}
  for (const column of MAPPABLE_COLUMNS) {
    const map = buildValueMap(column, columnValues(raw, columnMap, column), notes)
    if (Object.keys(map).length > 0) valueMap[column] = map
  }

  return { columnMap, dateFormat: date.format, numberFormat: numbers.format, valueMap, branchGeo: {}, notes: limitNotes(notes) }
}

const isValidGeo = (p: GeoPoint | undefined): p is GeoPoint =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180

/** Merge an LLM proposal over the heuristic one (LLM wins where valid) and drop entries that reference unknown headers/columns. */
export function mergeMappings(base: Mapping, proposal: Partial<Mapping>): Mapping {
  const columnMap = { ...base.columnMap }
  const ownerByColumn = new Map<CanonicalColumn, string>() // canonical column -> header the proposal chose for it
  for (const [header, column] of Object.entries(proposal.columnMap ?? {})) {
    if (!(header in columnMap)) continue
    if (column !== null && (!CANONICAL_COLUMNS.includes(column) || ownerByColumn.has(column))) continue
    columnMap[header] = column
    if (column !== null) ownerByColumn.set(column, header)
  }
  // A canonical column can come from one header only; the proposal's choice displaces the heuristic one.
  for (const [header, column] of Object.entries(columnMap)) {
    if (column && ownerByColumn.has(column) && ownerByColumn.get(column) !== header) columnMap[header] = null
  }

  const valueMap: Mapping['valueMap'] = {}
  for (const column of MAPPABLE_COLUMNS) {
    const merged = { ...base.valueMap[column], ...proposal.valueMap?.[column] }
    const clean = Object.fromEntries(Object.entries(merged).filter(([from, to]) => from.trim() !== '' && isValidTarget(to)))
    if (Object.keys(clean).length > 0) valueMap[column] = clean
  }

  const branchGeo = { ...base.branchGeo }
  for (const [branch, point] of Object.entries(proposal.branchGeo ?? {})) if (isValidGeo(point)) branchGeo[branch] = point

  const dateFormats: DateFormat[] = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY']
  const numberFormats: NumberFormat[] = ['plain', 'id', 'en']

  return {
    columnMap,
    dateFormat: proposal.dateFormat && dateFormats.includes(proposal.dateFormat) ? proposal.dateFormat : base.dateFormat,
    numberFormat: proposal.numberFormat && numberFormats.includes(proposal.numberFormat) ? proposal.numberFormat : base.numberFormat,
    valueMap,
    branchGeo,
    notes: limitNotes([...new Set([...base.notes, ...(proposal.notes ?? [])])]),
  }
}

const NUMBER_EXAMPLE: Record<NumberFormat, string> = { plain: '1234567.5', id: '1.234.567,5', en: '1,234,567.5' }

/**
 * A confirmed mapping applied to a new file of the same export (push API, re-upload). The column and value fixes the
 * user confirmed still hold, but the date and number formats are read from this file: the same 15 headers can come
 * with "1.641.600" one day and "1641600" the next. The confirmed format only settles what this file's values leave
 * open (every day <= 12, only "528.000"-like numbers). Headers the file no longer has are dropped, so a missing
 * required column is reported instead of looked up.
 */
export function reuseMapping(confirmed: Mapping, raw: RawTable): Mapping {
  const columnMap: Mapping['columnMap'] = {}
  // hasOwn: a header named "constructor" must not pick up Object.prototype's.
  for (const header of raw.headers) columnMap[header] = Object.hasOwn(confirmed.columnMap, header) ? (confirmed.columnMap[header] ?? null) : null

  const notes = [...confirmed.notes]
  const date = sniffDateFormat(columnValues(raw, columnMap, 'date'))
  const dateFormat = date.note ? confirmed.dateFormat : date.format
  if (dateFormat !== confirmed.dateFormat) notes.push(`Dates in this file are written ${dateFormat}; read them that way.`)

  const numbers = sniffNumberFormat(NUMERIC_COLUMNS.flatMap((c) => columnValues(raw, columnMap, c)))
  const numberFormat = numbers.note ? confirmed.numberFormat : numbers.format
  if (numberFormat !== confirmed.numberFormat) notes.push(`Numbers in this file are written ${NUMBER_EXAMPLE[numberFormat]}; read them that way.`)

  return { ...confirmed, columnMap, dateFormat, numberFormat, notes: limitNotes(notes) }
}

/** Required canonical columns not covered by mapping.columnMap. */
export function missingRequiredColumns(mapping: Mapping): CanonicalColumn[] {
  const mapped = new Set(Object.values(mapping.columnMap))
  return REQUIRED_COLUMNS.filter((c) => !mapped.has(c))
}

/**
 * Cache key for confirmed mappings: the headers plus the spellings in the mappable columns, which is exactly what a
 * mapping depends on. Invoice numbers and outlet ids are left out, otherwise every new export would get a new key.
 */
export function profileKey(profile: DataProfile): string {
  const headers = [...profile.headers].sort(compareText)
  const parts = [headers.join('\u001f')]
  for (const header of headers) {
    const column = resolveHeader(header)
    if (!column || !(MAPPABLE_COLUMNS as readonly string[]).includes(column)) continue
    const values = (profile.distinctValues[header] ?? []).map((d) => d.value).sort(compareText)
    parts.push(`${header}=${values.join('\u001f')}`)
  }
  return `p_${fnv1a(parts.join('\u001e'))}`
}
