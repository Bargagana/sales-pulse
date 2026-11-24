import { describe, expect, it } from 'vitest'
import { BUILTIN_BRANCH_GEO, CANONICAL_COLUMNS, cleanTable, heuristicMapping, parseCsv, UNASSIGNED_SALESMAN, UNMAPPED, type Mapping } from './index'

const HEADER = CANONICAL_COLUMNS.join(',')

/** One CSV line in canonical column order; only the fields a test cares about need overriding. */
function line(overrides: Partial<Record<(typeof CANONICAL_COLUMNS)[number], string>> = {}): string {
  const defaults: Record<string, string> = {
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
    qty_carton: '2',
    price_per_carton_idr: '100',
    gross_sales_idr: '200',
    discount_idr: '20',
    net_sales_idr: '180',
  }
  return CANONICAL_COLUMNS.map((c) => overrides[c] ?? defaults[c]).join(',')
}

function clean(lines: string[], mappingOverrides: Partial<Mapping> = {}, opts?: Parameters<typeof cleanTable>[2]) {
  const raw = parseCsv([HEADER, ...lines].join('\n'))
  return cleanTable(raw, { ...heuristicMapping(raw), ...mappingOverrides }, opts)
}

describe('cleanTable: trim', () => {
  it('trims every cell and counts the trimmed values', () => {
    const { rows, quality } = clean([line({ outlet_name: '  Toko Satu ', brand: 'Sukro ' }), line({ invoice_no: 'INV2' })])
    expect(rows[0]!.outlet_name).toBe('Toko Satu')
    expect(rows[0]!.brand).toBe('Sukro')
    expect(quality.valuesTrimmed).toBe(2)
  })
})

describe('cleanTable: value maps', () => {
  it('applies the confirmed maps to trimmed values and reports before -> after with counts', () => {
    const { rows, quality } = clean([line({ region: 'Jabar' }), line({ region: ' Jabar ', invoice_no: 'INV2' }), line({ invoice_no: 'INV3' })], {
      valueMap: { region: { Jabar: 'Jawa Barat' } },
    })
    expect(rows.map((r) => r.region)).toEqual(['Jawa Barat', 'Jawa Barat', 'Jawa Barat'])
    expect(quality.valuesFixed).toEqual([{ column: 'region', from: 'Jabar', to: 'Jawa Barat', count: 2 }])
  })

  it('ignores columns the mapping does not select', () => {
    const raw = parseCsv(`${HEADER},remarks\n${line()},hello`)
    const mapping = heuristicMapping(raw)
    expect(mapping.columnMap.remarks).toBeNull()
    expect(cleanTable(raw, mapping).rows[0]).not.toHaveProperty('remarks')
  })
})

describe('cleanTable: unparseable required values', () => {
  it('drops rows with an unreadable date, net, region, outlet id or brand and lists them', () => {
    const { rows, quality } = clean([
      line({ date: '2026-13-01' }),
      line({ net_sales_idr: 'n/a' }),
      line({ region: '' }),
      line({ outlet_id: '', brand: '' }),
      line({ invoice_no: 'OK' }),
    ])
    expect(rows.map((r) => r.invoice_no)).toEqual(['OK'])
    expect(quality.rowsRead).toBe(5)
    expect(quality.rowsClean).toBe(1)
    expect(quality.unparseable).toEqual([
      { row: 1, column: 'date', value: '2026-13-01' },
      { row: 2, column: 'net_sales_idr', value: 'n/a' },
      { row: 3, column: 'region', value: '' },
      { row: 4, column: 'outlet_id', value: '' },
      { row: 4, column: 'brand', value: '' },
    ])
  })

  it('treats an empty optional number as 0 and lets the arithmetic check flag an unreadable one', () => {
    const { rows, quality } = clean([line({ discount_idr: '', gross_sales_idr: '180', price_per_carton_idr: '90' }), line({ invoice_no: 'INV2', qty_carton: 'two' })])
    expect(rows[0]!.discount_idr).toBe(0)
    expect(rows[1]!.qty_carton).toBe(0)
    expect(quality.unparseable).toEqual([])
    expect(quality.arithmeticMismatches).toEqual([{ row: 2, reason: 'gross' }])
  })

  it('throws when a required column is not mapped at all', () => {
    const raw = parseCsv('date,region\n2026-10-01,Jawa Barat')
    expect(() => cleanTable(raw, heuristicMapping(raw))).toThrow(/Required columns are not mapped: outlet_id, brand, net_sales_idr/)
  })
})

describe('cleanTable: duplicates', () => {
  it('drops rows identical in every column after trimming and mapping, keeping the first copy', () => {
    const { rows, quality } = clean(
      [line(), line({ invoice_no: 'INV2' }), line({ region: ' JAWA BARAT ' }), line({ invoice_no: 'INV2' })],
      { valueMap: { region: { 'JAWA BARAT': 'Jawa Barat' } } },
    )
    expect(rows).toHaveLength(2)
    expect(quality.duplicatesRemoved).toBe(2)
    expect(quality.duplicateRowNumbers).toEqual([3, 4])
  })

  it('treats numbers that parse to the same value as identical', () => {
    const { quality } = clean([line({ net_sales_idr: '180' }), line({ net_sales_idr: '180.0' })])
    expect(quality.duplicatesRemoved).toBe(1)
  })

  it('keeps lines that differ in any column', () => {
    expect(clean([line(), line({ qty_carton: '3', gross_sales_idr: '300', net_sales_idr: '280' })]).quality.duplicatesRemoved).toBe(0)
  })
})

describe('cleanTable: returns', () => {
  it('keeps negative quantities and RTR invoices as negative sales and totals them', () => {
    const { rows, quality } = clean([
      line({ invoice_no: 'INV9', qty_carton: '-2', gross_sales_idr: '-200', discount_idr: '0', net_sales_idr: '-200' }),
      line({ invoice_no: 'rtr001', qty_carton: '-1', gross_sales_idr: '-100', discount_idr: '0', net_sales_idr: '-100' }),
      line({ invoice_no: 'INV10' }),
    ])
    expect(rows.map((r) => r.isReturn)).toEqual([true, true, false])
    expect(quality.returnLines).toBe(2)
    expect(quality.returnNet).toBe(-300)
    expect(rows.reduce((n, r) => n + r.net_sales_idr, 0)).toBe(-120)
  })
})

describe('cleanTable: outlet identity', () => {
  it('uses the most frequent name per outlet_id as display name and reports the variants', () => {
    const { rows, quality } = clean([
      line({ invoice_no: 'A', outlet_name: 'Toko Satu' }),
      line({ invoice_no: 'B', outlet_name: 'Toko Satu' }),
      line({ invoice_no: 'C', outlet_name: 'TK Satu' }),
    ])
    expect(new Set(rows.map((r) => r.outlet_name))).toEqual(new Set(['Toko Satu']))
    expect(quality.outletIdsWithNameVariants).toEqual([{ outletId: 'OUT1', names: ['Toko Satu', 'TK Satu'] }])
  })

  it('takes the first-seen name on a tie', () => {
    const { rows } = clean([line({ invoice_no: 'A', outlet_name: 'Beta' }), line({ invoice_no: 'B', outlet_name: 'Alpha' })])
    expect(rows.map((r) => r.outlet_name)).toEqual(['Beta', 'Beta'])
  })

  it('never merges different ids that share a name, and reports the shared name', () => {
    const { rows, quality } = clean([line({ outlet_id: 'OUT2', outlet_name: 'Toko Anugerah' }), line({ outlet_id: 'OUT1', outlet_name: 'Toko Anugerah' })])
    expect(new Set(rows.map((r) => r.outlet_id)).size).toBe(2)
    expect(quality.sharedOutletNames).toEqual([{ name: 'Toko Anugerah', outletIds: ['OUT1', 'OUT2'] }])
  })
})

describe('cleanTable: missing salesman', () => {
  it('fills blank salesman with Unassigned and counts the rows', () => {
    const { rows, quality } = clean([line({ salesman: '' }), line({ invoice_no: 'INV2', salesman: '  ' })])
    expect(rows.map((r) => r.salesman)).toEqual([UNASSIGNED_SALESMAN, UNASSIGNED_SALESMAN])
    expect(quality.missingSalesman).toBe(2)
  })
})

describe('cleanTable: arithmetic check', () => {
  it('flags qty x price != gross and gross - discount != net, but keeps the reported net', () => {
    const { rows, quality } = clean([
      line({ invoice_no: 'A', gross_sales_idr: '250', net_sales_idr: '230' }),
      line({ invoice_no: 'B', net_sales_idr: '999' }),
      line({ invoice_no: 'C' }),
    ])
    expect(quality.arithmeticMismatches).toEqual([
      { row: 1, reason: 'gross' },
      { row: 2, reason: 'net' },
    ])
    expect(rows[1]!.net_sales_idr).toBe(999)
  })

  it('tolerates sub-rupiah rounding', () => {
    expect(clean([line({ price_per_carton_idr: '33.33', qty_carton: '3', gross_sales_idr: '99.99', discount_idr: '0', net_sales_idr: '99.99' })]).quality.arithmeticMismatches).toEqual([])
  })
})

describe('cleanTable: unknown values (push API)', () => {
  it('marks values outside the confirmed maps as Unmapped and reports them', () => {
    const { rows, quality } = clean([line({ region: 'Papua' }), line({ invoice_no: 'B', region: 'Papua', salesman: '' }), line({ invoice_no: 'C' })], {}, {
      knownValues: { region: ['Jawa Barat'], salesman: ['Andi'] },
    })
    expect(rows.map((r) => r.region)).toEqual([UNMAPPED, UNMAPPED, 'Jawa Barat'])
    // Unassigned is produced by cleaning itself, so it is never "unknown".
    expect(rows[1]!.salesman).toBe(UNASSIGNED_SALESMAN)
    expect(quality.unmapped).toEqual([{ column: 'region', value: 'Papua', count: 2 }])
  })

  it('does nothing without knownValues', () => {
    expect(clean([line({ region: 'Papua' })]).quality.unmapped).toEqual([])
  })
})

describe('cleanTable: missing optional columns', () => {
  it("fills '' and 0, lists them in missingColumns and skips checks that need them", () => {
    const raw = parseCsv('Tanggal,Wilayah,Kode Outlet,Merek,Net Sales\n2026-10-01,Jawa Barat,OUT1,Sukro,180\n')
    const dataset = cleanTable(raw, heuristicMapping(raw))
    expect(dataset.presentColumns).toEqual(['date', 'region', 'outlet_id', 'brand', 'net_sales_idr'])
    expect(dataset.quality.missingColumns).toEqual([
      'invoice_no',
      'branch',
      'outlet_name',
      'outlet_type',
      'salesman',
      'sku',
      'qty_carton',
      'price_per_carton_idr',
      'gross_sales_idr',
      'discount_idr',
    ])
    expect(dataset.rows[0]).toMatchObject({ branch: '', salesman: '', qty_carton: 0, net_sales_idr: 180, isReturn: false })
    expect(dataset.quality.missingSalesman).toBe(0)
    expect(dataset.quality.arithmeticMismatches).toEqual([])
  })
})

describe('cleanTable: dataset envelope', () => {
  it('merges built-in coordinates with confirmed ones for the branches present', () => {
    const kudus = { lat: -6.8, lon: 110.84 }
    const dataset = clean([line({ branch: 'Bandung' }), line({ invoice_no: 'B', branch: 'Kudus' }), line({ invoice_no: 'C', branch: 'Atlantis' })], {
      branchGeo: { Kudus: kudus, Surabaya: { lat: 0, lon: 0 } },
    })
    expect(dataset.branchGeo).toEqual({ Bandung: BUILTIN_BRANCH_GEO.Bandung, Kudus: kudus })
  })

  it('is deterministic: same input and mapping give the same dataset id', () => {
    expect(clean([line()]).id).toBe(clean([line()]).id)
    expect(clean([line()]).id).not.toBe(clean([line({ net_sales_idr: '181' })]).id)
    expect(clean([line()], {}, { datasetId: 'ds_x', createdAt: '2026-11-23T00:00:00.000Z' })).toMatchObject({ id: 'ds_x', createdAt: '2026-11-23T00:00:00.000Z' })
  })

  it('parses dates and numbers with the mapping formats', () => {
    const raw = parseCsv('Tanggal;Wilayah;Kode Outlet;Merek;Penjualan Bersih\n31/10/2026;Jawa Barat;OUT1;Sukro;Rp 1.234.567\n')
    const { rows } = cleanTable(raw, heuristicMapping(raw))
    expect(rows[0]).toMatchObject({ date: '2026-10-31', net_sales_idr: 1_234_567 })
  })
})
