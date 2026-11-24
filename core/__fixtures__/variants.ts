// Builds messy variants of data/data.csv for the AC3 robustness tests. Every transform is deterministic and keeps
// the meaning of each row, so every variant must clean to the same golden numbers.

export interface Table {
  headers: string[]
  rows: string[][]
}

export interface CsvOptions {
  delimiter?: ',' | ';' | '\t'
  eol?: '\n' | '\r\n'
  bom?: boolean
}

/** Splits the sample file. It has no quoted fields, so a plain split is enough for the source. */
export function readSample(csv: string): Table {
  const [header, ...lines] = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  return { headers: header!.split(','), rows: lines.map((l) => l.split(',')) }
}

export function toCsv(table: Table, opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ','
  const quote = (cell: string) => (/["\r\n]/.test(cell) || cell.includes(delimiter) ? `"${cell.replace(/"/g, '""')}"` : cell)
  const lines = [table.headers, ...table.rows].map((cells) => cells.map(quote).join(delimiter))
  return (opts.bom ? '﻿' : '') + lines.join(opts.eol ?? '\r\n') + (opts.eol ?? '\r\n')
}

const column = (table: Table, name: string) => {
  const index = table.headers.indexOf(name)
  if (index === -1) throw new Error(`No column ${name}`)
  return index
}

export function mapColumn(table: Table, name: string, fn: (value: string, rowIndex: number) => string): Table {
  const index = column(table, name)
  return { headers: table.headers, rows: table.rows.map((row, i) => row.map((cell, j) => (j === index ? fn(cell, i) : cell))) }
}

export function renameHeaders(table: Table, names: Record<string, string>): Table {
  return { headers: table.headers.map((h) => names[h] ?? h), rows: table.rows }
}

/** Fixed permutation (not random) so failures are reproducible. */
export function shuffleColumns(table: Table): Table {
  const order = table.headers.map((_, i) => i).sort((a, b) => ((a * 7) % 11) - ((b * 7) % 11) || b - a)
  return { headers: order.map((i) => table.headers[i]!), rows: table.rows.map((row) => order.map((i) => row[i]!)) }
}

const MONEY = ['price_per_carton_idr', 'gross_sales_idr', 'discount_idr', 'net_sales_idr']
const NUMBERS = ['qty_carton', ...MONEY]

function group(value: string, separator: string): string {
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  return (negative ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/** "1725966000" -> "Rp 1.725.966.000" (money) / "12" (qty). */
export function indonesianNumbers(table: Table): Table {
  return NUMBERS.reduce((t, name) => mapColumn(t, name, (v) => (MONEY.includes(name) ? `Rp ${group(v, '.')}` : group(v, '.'))), table)
}

/** "1725966000" -> "1,725,966,000"; in a comma CSV these cells must be quoted. */
export function englishNumbers(table: Table): Table {
  return NUMBERS.reduce((t, name) => mapColumn(t, name, (v) => group(v, ',')), table)
}

export function reformatDates(table: Table, format: 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'MM/DD/YYYY' | 'D/M/YYYY'): Table {
  return mapColumn(table, 'date', (iso) => {
    const [y, m, d] = iso.split('-') as [string, string, string]
    if (format === 'DD/MM/YYYY') return `${d}/${m}/${y}`
    if (format === 'DD-MM-YYYY') return `${d}-${m}-${y}`
    if (format === 'MM/DD/YYYY') return `${m}/${d}/${y}`
    return `${Number(d)}/${Number(m)}/${y}`
  })
}

const REGION_ABBREVIATIONS: Record<string, string> = {
  'Jawa Barat': 'Jabar',
  'Jawa Tengah': 'Jateng',
  'Jawa Timur': 'Jatim',
  Sumatera: 'Sumatra',
  Jabodetabek: 'JABODETABEK',
  Kalimantan: 'kalimantan',
}

/** Casing, spacing and abbreviation errors on a minority of rows, so the correct spelling stays the most frequent. */
export function messyValues(table: Table): Table {
  const spacing = [(v: string) => v.toUpperCase(), (v: string) => v.toLowerCase(), (v: string) => v.replace(' ', '  '), (v: string) => ` ${v} `]
  let t = mapColumn(table, 'region', (v, i) => (i % 13 === 0 ? (REGION_ABBREVIATIONS[v] ?? v) : i % 7 === 0 ? spacing[i % 4]!(v) : v))
  t = mapColumn(t, 'brand', (v, i) => (i % 5 === 0 ? spacing[i % 4]!(v) : v))
  t = mapColumn(t, 'outlet_type', (v, i) => (i % 9 === 0 ? spacing[i % 4]!(v) : v))
  t = mapColumn(t, 'salesman', (v, i) => (i % 6 === 0 && v ? v.toUpperCase() : v))
  t = mapColumn(t, 'outlet_name', (v, i) => (i % 4 === 0 ? `  ${v} ` : v))
  t = mapColumn(t, 'invoice_no', (v, i) => (i % 8 === 0 ? ` ${v}` : v))
  return t
}

export const ENGLISH_HEADERS: Record<string, string> = {
  date: 'Date',
  invoice_no: 'Invoice No',
  region: 'Region',
  branch: 'Branch',
  outlet_id: 'Outlet ID',
  outlet_name: 'Outlet Name',
  outlet_type: 'Outlet Type',
  salesman: 'Salesman',
  brand: 'Brand',
  sku: 'SKU',
  qty_carton: 'Qty',
  price_per_carton_idr: 'Price',
  gross_sales_idr: 'Gross Sales',
  discount_idr: 'Discount',
  net_sales_idr: 'Net Sales',
}

export const BAHASA_HEADERS: Record<string, string> = {
  date: 'Tanggal',
  invoice_no: 'No Faktur',
  region: 'Wilayah',
  branch: 'Cabang',
  outlet_id: 'Kode Outlet',
  outlet_name: 'Nama Outlet',
  outlet_type: 'Tipe Outlet',
  salesman: 'Nama Sales',
  brand: 'Merek',
  sku: 'Produk',
  qty_carton: 'Jumlah Karton',
  price_per_carton_idr: 'Harga per Karton',
  gross_sales_idr: 'Penjualan Kotor',
  discount_idr: 'Diskon',
  net_sales_idr: 'Penjualan Bersih',
}

export interface Variant {
  name: string
  csv: string
}

/** Every AC3 variant, plus one that combines all of them. */
export function buildVariants(sampleCsv: string): Variant[] {
  const base = readSample(sampleCsv)
  return [
    { name: 'shuffled column order', csv: toCsv(shuffleColumns(base)) },
    { name: 'English headers (Region, Net Sales, ...)', csv: toCsv(renameHeaders(base, ENGLISH_HEADERS)) },
    { name: 'Bahasa headers (Tanggal, Wilayah, Merek, ...)', csv: toCsv(renameHeaders(base, BAHASA_HEADERS)) },
    { name: 'semicolon + Indonesian numbers with Rp', csv: toCsv(indonesianNumbers(base), { delimiter: ';' }) },
    { name: 'English numbers in quoted comma CSV', csv: toCsv(englishNumbers(base)) },
    { name: 'DD/MM/YYYY dates', csv: toCsv(reformatDates(base, 'DD/MM/YYYY')) },
    { name: 'D/M/YYYY dates without padding', csv: toCsv(reformatDates(base, 'D/M/YYYY')) },
    { name: 'DD-MM-YYYY dates', csv: toCsv(reformatDates(base, 'DD-MM-YYYY')) },
    { name: 'MM/DD/YYYY dates', csv: toCsv(reformatDates(base, 'MM/DD/YYYY')) },
    { name: 'tab separated, BOM, LF', csv: toCsv(base, { delimiter: '\t', bom: true, eol: '\n' }) },
    { name: 'casing, spacing and abbreviation errors', csv: toCsv(messyValues(base)) },
    {
      name: 'all of the above combined',
      csv: toCsv(shuffleColumns(renameHeaders(indonesianNumbers(reformatDates(messyValues(base), 'DD/MM/YYYY')), BAHASA_HEADERS)), {
        delimiter: ';',
        bom: true,
        eol: '\n',
      }),
    },
  ]
}
