import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SalesRow } from '../types'

export const SAMPLE_CSV_PATH = fileURLToPath(new URL('../../data/data.csv', import.meta.url))
export const readSampleCsv = () => readFileSync(SAMPLE_CSV_PATH, 'utf8')

/** A clean SalesRow with sensible defaults; tests override only what they care about. */
export function salesRow(overrides: Partial<SalesRow> = {}): SalesRow {
  return {
    date: '2026-10-01',
    invoice_no: 'INV1',
    region: 'Jawa Barat',
    branch: 'Bandung',
    outlet_id: 'OUT1',
    outlet_name: 'Toko Satu',
    outlet_type: 'Warung',
    salesman: 'Andi',
    brand: 'Sukro',
    sku: 'Sukro Pedas 100g',
    qty_carton: 1,
    price_per_carton_idr: 100,
    gross_sales_idr: 100,
    discount_idr: 0,
    net_sales_idr: 100,
    isReturn: false,
    ...overrides,
  }
}

/** One row per (outlet, month) with the given net, for weakest-outlet scenarios. */
export function outletMonth(outletId: string, outletType: string, date: string, net: number, extra: Partial<SalesRow> = {}): SalesRow {
  return salesRow({ outlet_id: outletId, outlet_name: `Outlet ${outletId}`, outlet_type: outletType, date, net_sales_idr: net, gross_sales_idr: net, price_per_carton_idr: net, ...extra })
}
