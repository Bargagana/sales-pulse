import { describe, expect, it } from 'vitest'
import { readSampleCsv } from './__fixtures__/rows'
import {
  CANONICAL_COLUMNS,
  heuristicMapping,
  KNOWN_REGION_ALIASES,
  mergeMappings,
  missingRequiredColumns,
  parseCsv,
  profileKey,
  profileTable,
  reuseMapping,
  cleanTable,
  type Mapping,
  type RawTable,
} from './index'
import { buildVariants, indonesianNumbers, readSample, reformatDates, toCsv } from './__fixtures__/variants'
import { sniffDateFormat, sniffNumberFormat } from './mapping'
import { mappingSchema } from './schemas'

const table = (headers: string[], rows: string[][] = []): RawTable => ({ headers, rows, delimiter: ',' })

/** A table with one column, for value-map tests. */
const regionTable = (values: string[]) => table(['region'], values.map((v) => [v]))

describe('heuristicMapping: headers', () => {
  it('maps the sample headers one to one', () => {
    const raw = parseCsv(readSampleCsv())
    const mapping = heuristicMapping(raw)
    expect(mapping.columnMap).toEqual(Object.fromEntries(CANONICAL_COLUMNS.map((c) => [c, c])))
    expect(mapping.dateFormat).toBe('YYYY-MM-DD')
    expect(mapping.numberFormat).toBe('plain')
  })

  it.each([
    ['Tanggal', 'date'],
    ['TGL', 'date'],
    ['No. Faktur', 'invoice_no'],
    ['Wilayah', 'region'],
    ['Region', 'region'],
    ['Cabang', 'branch'],
    ['Kode_Outlet', 'outlet_id'],
    ['outlet-id', 'outlet_id'],
    ['Nama Toko', 'outlet_name'],
    ['Tipe Outlet', 'outlet_type'],
    ['Nama Sales', 'salesman'],
    ['Merek', 'brand'],
    ['MERK', 'brand'],
    ['Produk', 'sku'],
    ['Qty', 'qty_carton'],
    ['Harga per Karton (Rp)', 'price_per_carton_idr'],
    ['Penjualan Kotor', 'gross_sales_idr'],
    ['Diskon', 'discount_idr'],
    ['Penjualan Bersih', 'net_sales_idr'],
    ['Net Sales', 'net_sales_idr'],
    ['  NET_SALES (IDR) ', 'net_sales_idr'],
  ])('recognises %j as %s', (header, column) => {
    expect(heuristicMapping(table([header])).columnMap[header]).toBe(column)
  })

  it('ignores unknown headers with a note', () => {
    const mapping = heuristicMapping(table(['Date', 'Remarks']))
    expect(mapping.columnMap.Remarks).toBeNull()
    expect(mapping.notes.join(' ')).toContain('"Remarks" was not recognised')
  })

  it('maps a canonical column from the first matching header only', () => {
    const mapping = heuristicMapping(table(['Net Sales', 'Penjualan Bersih']))
    expect(mapping.columnMap).toEqual({ 'Net Sales': 'net_sales_idr', 'Penjualan Bersih': null })
  })

  it('notes missing required columns', () => {
    expect(heuristicMapping(table(['Date', 'Brand'])).notes.join(' ')).toContain('Required columns not found: region, outlet_id, net_sales_idr')
  })
})

describe('date format sniffing', () => {
  it.each([
    [['2026-09-01', '2026-10-31'], 'YYYY-MM-DD'],
    [['01/09/2026', '31/10/2026'], 'DD/MM/YYYY'],
    [['09/01/2026', '10/31/2026'], 'MM/DD/YYYY'],
    [['01-09-2026', '31-10-2026'], 'DD-MM-YYYY'],
    [['2026-09-01 00:00:00'], 'YYYY-MM-DD'],
  ])('%j -> %s without a note', (values, format) => {
    expect(sniffDateFormat(values)).toEqual({ format })
  })

  it('prefers DD/MM (Indonesian convention) when every day is at most 12, and says so', () => {
    const result = sniffDateFormat(['01/09/2026', '12/10/2026'])
    expect(result.format).toBe('DD/MM/YYYY')
    expect(result.note).toMatch(/ambiguous; assumed DD\/MM\/YYYY/)
  })

  it('notes conflicting day-first and month-first dates', () => {
    expect(sniffDateFormat(['31/01/2026', '01/31/2026']).note).toMatch(/mix day-first and month-first/)
  })

  it('notes an unrecognised date column', () => {
    expect(sniffDateFormat(['Sept 1st'])).toMatchObject({ format: 'YYYY-MM-DD', note: expect.stringMatching(/not recognised/) })
  })
})

describe('number format sniffing', () => {
  it.each([
    [['1725966000', '-528000', '0'], 'plain'],
    [['12.5', '100'], 'plain'],
    [['1.725.966.000', '528.000'], 'id'],
    [['Rp 1.234,5'], 'id'],
    [['12,5'], 'id'],
    [['1,725,966,000', '528,000'], 'en'],
    [['1,234.5'], 'en'],
  ])('%j -> %s', (values, format) => {
    expect(sniffNumberFormat(values)).toEqual({ format })
  })

  it('reads lone "528.000" as Indonesian thousands, with a note', () => {
    expect(sniffNumberFormat(['528.000', '198.000'])).toMatchObject({ format: 'id', note: expect.stringMatching(/assumed Indonesian thousands/) })
  })

  it('reads lone "528,000" as thousands, with a note', () => {
    expect(sniffNumberFormat(['528,000'])).toMatchObject({ format: 'en', note: expect.stringMatching(/assumed thousands/) })
  })

  it('notes mixed separators and follows the majority', () => {
    expect(sniffNumberFormat(['1.234.567', '2.345.678', '1,234,567'])).toMatchObject({ format: 'id', note: expect.stringMatching(/mix/) })
  })
})

describe('heuristicMapping: value maps', () => {
  it('folds case and whitespace variants into the most frequent spelling', () => {
    const mapping = heuristicMapping(regionTable(['Jawa Barat', 'Jawa Barat', 'JAWA BARAT', 'jawa  barat']))
    expect(mapping.valueMap.region).toEqual({ 'JAWA BARAT': 'Jawa Barat', 'jawa  barat': 'Jawa Barat' })
  })

  it('prefers the Title Case spelling on a tie', () => {
    expect(heuristicMapping(regionTable(['KALIMANTAN', 'Kalimantan'])).valueMap.region).toEqual({ KALIMANTAN: 'Kalimantan' })
  })

  it('expands known Indonesian region abbreviations and notes them', () => {
    const mapping = heuristicMapping(regionTable(['Jawa Barat', 'Jabar', 'Jateng', 'JATIM', 'Jabotabek']))
    expect(mapping.valueMap.region).toEqual({ Jabar: 'Jawa Barat', Jateng: 'Jawa Tengah', JATIM: 'Jawa Timur', Jabotabek: 'Jabodetabek' })
    expect(mapping.notes).toContain('Region "Jabar" is a known abbreviation of "Jawa Barat".')
  })

  it('resolves an abbreviation to the region level the dataset already uses', () => {
    expect(heuristicMapping(regionTable(['Sumatera', 'Sumut'])).valueMap.region).toEqual({ Sumut: 'Sumatera' })
    expect(heuristicMapping(regionTable(['Sumut'])).valueMap.region).toEqual({ Sumut: 'Sumatera Utara' })
    expect(heuristicMapping(regionTable(['Jabodetabek', 'DKI'])).valueMap.region).toEqual({ DKI: 'Jabodetabek' })
    expect(heuristicMapping(regionTable(['D.K.I. Jakarta'])).valueMap.region).toEqual({ 'D.K.I. Jakarta': 'DKI Jakarta' })
  })

  it('uses the dataset spelling of an abbreviation target', () => {
    expect(heuristicMapping(regionTable(['JAWA BARAT', 'JAWA BARAT', 'Jabar'])).valueMap.region).toEqual({ Jabar: 'JAWA BARAT' })
  })

  it('exports the alias table keyed by lowercase letters and digits', () => {
    expect(KNOWN_REGION_ALIASES.jabar).toEqual(['Jawa Barat'])
    expect(Object.keys(KNOWN_REGION_ALIASES).every((k) => /^[a-z0-9]+$/.test(k))).toBe(true)
  })

  it('folds brands too, but never applies region aliases to them', () => {
    const mapping = heuristicMapping(table(['brand'], [['Sukro'], ['Sukro'], ['SUKRO'], ['Jabar']]))
    expect(mapping.valueMap.brand).toEqual({ SUKRO: 'Sukro' })
  })

  it('leaves valueMap empty for clean data', () => {
    expect(heuristicMapping(regionTable(['Jawa Barat', 'Kalimantan'])).valueMap).toEqual({})
  })
})

describe('mergeMappings', () => {
  const base: Mapping = {
    columnMap: { Tanggal: 'date', Area: 'region', Nilai: null, Omzet: 'net_sales_idr' },
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'id',
    valueMap: { region: { Jabar: 'Jawa Barat' } },
    branchGeo: {},
    notes: ['base note'],
  }

  it('lets the proposal win where it is valid', () => {
    const merged = mergeMappings(base, {
      columnMap: { Nilai: 'net_sales_idr' },
      dateFormat: 'MM/DD/YYYY',
      valueMap: { region: { JABAR: 'Jawa Barat' }, brand: { SUKRO: 'Sukro' } },
      branchGeo: { Kudus: { lat: -6.8, lon: 110.84 } },
      notes: ['llm note', 'base note'],
    })
    // Nilai takes net_sales_idr, so Omzet is released.
    expect(merged.columnMap).toEqual({ Tanggal: 'date', Area: 'region', Nilai: 'net_sales_idr', Omzet: null })
    expect(merged.dateFormat).toBe('MM/DD/YYYY')
    expect(merged.numberFormat).toBe('id')
    expect(merged.valueMap).toEqual({ region: { Jabar: 'Jawa Barat', JABAR: 'Jawa Barat' }, brand: { SUKRO: 'Sukro' } })
    expect(merged.branchGeo).toEqual({ Kudus: { lat: -6.8, lon: 110.84 } })
    expect(merged.notes).toEqual(['base note', 'llm note'])
  })

  it('drops entries for unknown headers, unknown columns, bad formats and bad coordinates', () => {
    const merged = mergeMappings(base, {
      columnMap: { Ghost: 'brand', Area: 'not_a_column' as never },
      dateFormat: 'YYYY/MM/DD' as never,
      valueMap: { region: { '': 'X', Jateng: '' }, outlet_id: { A: 'B' } } as never,
      branchGeo: { Nowhere: { lat: 123, lon: 0 } },
    })
    expect(merged.columnMap).toEqual(base.columnMap)
    expect(merged.dateFormat).toBe('DD/MM/YYYY')
    expect(merged.valueMap).toEqual(base.valueMap)
    expect(merged.branchGeo).toEqual({})
  })

  it('lets the proposal ignore a column', () => {
    expect(mergeMappings(base, { columnMap: { Area: null } }).columnMap.Area).toBeNull()
  })

  it('never maps two headers to one column, even when the proposal itself claims it twice', () => {
    const merged = mergeMappings(base, { columnMap: { Nilai: 'net_sales_idr', Omzet: 'net_sales_idr' } })
    expect(Object.values(merged.columnMap).filter((c) => c === 'net_sales_idr')).toHaveLength(1)
    expect(merged.columnMap.Nilai).toBe('net_sales_idr')
  })
})

describe('mergeMappings: value-map targets', () => {
  it('rejects a target that contains markup, e.g. injected into the LLM proposal through a CSV cell', () => {
    const base = heuristicMapping(regionTable(['Sukro']))
    const merged = mergeMappings(base, { valueMap: { brand: { Sukro: '<img src=x onerror=alert(1)>', Sukr0: 'Sukro' } } })
    expect(merged.valueMap.brand).toEqual({ Sukr0: 'Sukro' })
  })
})

describe('reuseMapping', () => {
  const GOLDEN_NET = 1_725_966_000 // PRD §8 AC2
  const sample = readSampleCsv()
  const confirmed = heuristicMapping(parseCsv(sample))
  const netOf = (csv: string) => {
    const raw = parseCsv(csv)
    const dataset = cleanTable(raw, reuseMapping(confirmed, raw))
    return { net: dataset.rows.reduce((sum, r) => sum + r.net_sales_idr, 0), unparseable: dataset.quality.unparseable.length }
  }

  it('reads the same export written with Indonesian numbers and ";" to the golden total', () => {
    const csv = toCsv(indonesianNumbers(readSample(sample)), { delimiter: ';' })
    expect(reuseMapping(confirmed, parseCsv(csv)).numberFormat).toBe('id')
    expect(netOf(csv)).toEqual({ net: GOLDEN_NET, unparseable: 0 })
  })

  it('reads the same export written with DD/MM/YYYY dates to the golden total', () => {
    const csv = toCsv(reformatDates(readSample(sample), 'DD/MM/YYYY'))
    expect(reuseMapping(confirmed, parseCsv(csv)).dateFormat).toBe('DD/MM/YYYY')
    expect(netOf(csv)).toEqual({ net: GOLDEN_NET, unparseable: 0 })
  })

  it('keeps the confirmed format where the file alone is ambiguous', () => {
    const monthFirst: Mapping = { ...heuristicMapping(table(['date', 'net_sales_idr'])), dateFormat: 'MM/DD/YYYY' }
    const ambiguous = table(['date', 'net_sales_idr'], [['03/04/2026', '528.000'], ['05/06/2026', '100.000']])
    const reused = reuseMapping({ ...monthFirst, numberFormat: 'plain' }, ambiguous)
    expect(reused.dateFormat).toBe('MM/DD/YYYY')
    expect(reused.numberFormat).toBe('plain')
  })

  it('keeps the confirmed column and value fixes, and notes a format change', () => {
    const csv = toCsv(reformatDates(readSample(sample), 'DD/MM/YYYY'))
    const reused = reuseMapping(confirmed, parseCsv(csv))
    expect(reused.columnMap).toEqual(confirmed.columnMap)
    expect(reused.valueMap).toEqual(confirmed.valueMap)
    expect(reused.notes.at(-1)).toBe('Dates in this file are written DD/MM/YYYY; read them that way.')
  })

  it('drops headers the file no longer has, so a missing required column is reported', () => {
    const { headers, rows } = readSample(sample)
    const keep = headers.map((h, i) => (h === 'net_sales_idr' ? -1 : i)).filter((i) => i >= 0)
    const raw = parseCsv(toCsv({ headers: keep.map((i) => headers[i]!), rows: rows.map((r) => keep.map((i) => r[i]!)) }))
    expect(missingRequiredColumns(reuseMapping(confirmed, raw))).toEqual(['net_sales_idr'])
  })

  it('ignores a header named like an Object.prototype member', () => {
    expect(reuseMapping(confirmed, table(['constructor'])).columnMap).toEqual({ constructor: null })
  })
})

describe('schema round trip', () => {
  it('heuristic mappings of the sample and of every AC3 variant pass mappingSchema (ApplyRequest body)', () => {
    for (const { csv } of buildVariants(readSampleCsv())) {
      const mapping = heuristicMapping(parseCsv(csv))
      expect(mappingSchema.parse(mapping)).toEqual(mapping)
    }
  })

  it('keeps notes and value-map targets inside the schema limits', () => {
    const longHeader = 'x'.repeat(600)
    const longValue = `Jawa ${'Barat '.repeat(50)}`.trim()
    const mapping = heuristicMapping(table([longHeader, 'region'], [['1', longValue], ['2', longValue], ['3', longValue.toUpperCase()]]))
    expect(() => mappingSchema.parse(mapping)).not.toThrow()
    expect(mapping.valueMap.region).toBeUndefined()
  })
})

describe('missingRequiredColumns', () => {
  it('lists required columns no header maps to', () => {
    expect(missingRequiredColumns({ ...heuristicMapping(table(['Tanggal', 'Merek'])) })).toEqual(['region', 'outlet_id', 'net_sales_idr'])
    expect(missingRequiredColumns(heuristicMapping(parseCsv(readSampleCsv())))).toEqual([])
  })
})

describe('profileKey', () => {
  const raw = parseCsv(readSampleCsv())
  const key = profileKey(profileTable(raw))

  it('is deterministic and short', () => {
    expect(profileKey(profileTable(parseCsv(readSampleCsv())))).toBe(key)
    expect(key).toMatch(/^p_[0-9a-f]{8}$/)
  })

  it('ignores header order and value order', () => {
    const reversed: RawTable = { ...raw, headers: [...raw.headers].reverse(), rows: [...raw.rows].reverse().map((r) => [...r].reverse()) }
    expect(profileKey(profileTable(reversed))).toBe(key)
  })

  it('changes when a mappable spelling changes, not when invoice numbers do', () => {
    const regionIndex = raw.headers.indexOf('region')
    const invoiceIndex = raw.headers.indexOf('invoice_no')
    const newSpelling = { ...raw, rows: raw.rows.map((r, i) => (i === 0 ? r.map((c, j) => (j === regionIndex ? 'Jabodetabek Raya' : c)) : r)) }
    const newInvoices = { ...raw, rows: raw.rows.map((r) => r.map((c, j) => (j === invoiceIndex ? `X${c}` : c))) }
    expect(profileKey(profileTable(newSpelling))).not.toBe(key)
    expect(profileKey(profileTable(newInvoices))).toBe(key)
  })
})
