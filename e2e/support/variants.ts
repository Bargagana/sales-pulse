// Messy renderings of the sample for the push API. Each variant changes either only the representation (expected
// numbers stay the PRD golden ones) or the data in a known way (the oracle computes the expected numbers from the
// same changed table).
import { HEADERS, readSampleTable } from './oracle'

export type Table = string[][]
type Col = (typeof HEADERS)[number]
const col = (name: Col) => HEADERS.indexOf(name)
const NUMERIC: Col[] = ['qty_carton', 'price_per_carton_idr', 'gross_sales_idr', 'discount_idr', 'net_sales_idr']

export const sampleTable = (): Table => readSampleTable()

export function toCsv(headers: readonly string[], rows: Table, delimiter = ',', eol = '\n'): string {
  const cell = (v: string) => (/["\r\n]/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v)
  return [headers, ...rows].map((r) => r.map(cell).join(delimiter)).join(eol) + eol
}

export const sampleCsv = (rows = sampleTable()) => toCsv(HEADERS, rows)

/** "1725966000" -> "1.725.966.000", "-528000" -> "-528.000". */
const idNumber = (v: string) => {
  const n = Number(v)
  return `${n < 0 ? '-' : ''}${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** Indonesian headers an ERP export might use, all different from the canonical names. */
const RENAMED: Record<Col, string> = {
  date: 'Tanggal',
  invoice_no: 'No Faktur',
  region: 'Wilayah',
  branch: 'Cabang',
  outlet_id: 'Kode Outlet',
  outlet_name: 'Nama Outlet',
  outlet_type: 'Tipe Outlet',
  salesman: 'Salesman',
  brand: 'Merek',
  sku: 'Produk',
  qty_carton: 'Qty',
  price_per_carton_idr: 'Harga',
  gross_sales_idr: 'Penjualan Kotor',
  discount_idr: 'Diskon',
  net_sales_idr: 'Net Sales',
}

/** Case, spacing and abbreviation variants that must fold onto the six canonical regions. */
const REGION_SPELLINGS: Record<string, string[]> = {
  'Jawa Barat': ['jawa barat', ' Jawa  Barat ', 'Jabar'],
  'Jawa Tengah': ['JAWA TENGAH', 'Jawa tengah '],
  Sumatera: ['SUMATERA', ' sumatera'],
  Kalimantan: ['kalimantan'],
}

/**
 * Same data, messy shape (PRD AC3): shuffled and renamed columns, ";" delimiter, BOM and CRLF, Indonesian thousands,
 * "Rp" prefixes, DD/MM/YYYY dates and extra region spellings. Expected numbers = the golden ones.
 */
export function messyExport(): string {
  // Rotated by five: no column keeps its original position.
  const order: Col[] = [...HEADERS.slice(5), ...HEADERS.slice(0, 5)]
  const rows = sampleTable().map((cells, i) => {
    const out = [...cells]
    const [y, m, d] = out[col('date')]!.split('-')
    out[col('date')] = `${d}/${m}/${y}`
    for (const c of NUMERIC) out[col(c)] = idNumber(out[col(c)]!)
    if (i % 7 === 0) out[col('net_sales_idr')] = `Rp ${out[col('net_sales_idr')]}`
    const spellings = REGION_SPELLINGS[out[col('region')]!]
    if (spellings && i % 5 === 0) out[col('region')] = spellings[i % spellings.length]!
    return order.map((c) => out[col(c)]!)
  })
  return '﻿' + toCsv(order.map((c) => RENAMED[c]), rows, ';', '\r\n')
}

export function withBlankSalesman(outletId: string): Table {
  return sampleTable().map((cells) => (cells[col('outlet_id')] === outletId ? cells.map((v, i) => (i === col('salesman') ? '' : v)) : cells))
}

/** The outlet bought in the baseline month and nothing in the current one: it must show as -100% (PRD §6.4). */
export const withLapsedOutlet = (outletId: string): Table =>
  sampleTable().filter((cells) => !(cells[col('outlet_id')] === outletId && cells[col('date')]!.startsWith('2026-10')))

/** Export taken mid-month: only day 1..15 of October, so September must be compared on day 1..15 too. */
export const partialCurrentMonth = (lastDay = '2026-10-15'): Table => sampleTable().filter((cells) => cells[col('date')]! <= lastDay)

export const singleMonth = (month = '2026-10'): Table => sampleTable().filter((cells) => cells[col('date')]!.startsWith(month))

export const withoutColumn = (name: Col): string => {
  const keep = HEADERS.map((_, i) => i).filter((i) => i !== col(name))
  return toCsv(keep.map((i) => HEADERS[i]!), sampleTable().map((cells) => keep.map((i) => cells[i]!)))
}

export const replaceRegion = (from: string, to: string): Table =>
  sampleTable().map((cells) => (cells[col('region')] === from ? cells.map((v, i) => (i === col('region') ? to : v)) : cells))

export const COL = col
