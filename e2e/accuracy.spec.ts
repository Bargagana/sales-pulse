// Adversarial accuracy (PRD goal 1, AC2/AC3): every number the API returns is recomputed from the CSV by the
// independent oracle in support/oracle.ts (no core/ code), for the sample, filtered scopes and messy variants.
import { expect, test, type APIRequestContext } from '@playwright/test'
import type { Dataset, IngestResponse, SummaryResponse } from '../core/api-types'
import { GOLDEN, ingest, pushToken, restoreSample } from './support/app'
import * as oracle from './support/oracle'
import * as variants from './support/variants'

const CLOSE = 6 // decimal places for percentages and ratios

let token = ''
test.beforeAll(async ({ request }) => {
  token = await pushToken(request)
})
test.afterAll(async ({ request }) => {
  await restoreSample(request)
})

async function push(request: APIRequestContext, csv: string, query = ''): Promise<IngestResponse> {
  const res = await ingest(request, csv, query, token)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as IngestResponse
}

const toRows = (table: variants.Table) => oracle.clean(table)

/** Same checks for every push: quality counts, periods, KPIs and the weakest outlets in the mode the API chose. */
function expectResponseMatches(body: IngestResponse, table: variants.Table) {
  const { rows, duplicateRowNumbers } = toRows(table)
  const tot = oracle.totals(rows)
  const mom = oracle.mom(rows)
  const p = oracle.periods(rows)

  expect(body.quality.rowsRead).toBe(table.length)
  expect(body.quality.rowsClean).toBe(rows.length)
  expect(body.quality.duplicateRowNumbers).toEqual(duplicateRowNumbers)
  expect(body.periods).toEqual(p)
  expect(body.kpis).toMatchObject({
    netSales: tot.net,
    grossSales: tot.gross,
    discount: tot.discount,
    invoices: tot.invoices,
    activeOutlets: tot.outlets,
    returnLines: tot.returnLines,
    returnNet: tot.returnNet,
    currentNet: mom.current,
    baselineNet: mom.baseline,
  })
  if (mom.pct === null) expect(body.kpis.momPct).toBeNull()
  else expect(body.kpis.momPct).toBeCloseTo(mom.pct, CLOSE)

  if (p.baseline) {
    const expected = oracle.weakestDecline(rows).outlets
    expect(body.weakestOutlets.map((o) => o.outletId)).toEqual(expected.map((o) => o.outletId))
    body.weakestOutlets.forEach((o, i) => {
      const e = expected[i]!
      expect(o).toMatchObject({ name: e.name, outletType: e.outletType, baseline: e.baseline, current: e.current, change: e.current - e.baseline })
      expect(o.momPct).toBeCloseTo(e.momPct, CLOSE)
      expect(o.peerMedianPct).toBeCloseTo(e.peerMedianPct, CLOSE)
      expect(o.score).toBeCloseTo(e.score, CLOSE)
    })
  } else {
    const expected = oracle.weakestLowest(rows)
    expect(body.weakestOutlets.map((o) => o.outletId)).toEqual(expected.map((o) => o.outletId))
    body.weakestOutlets.forEach((o, i) => expect(o.score).toBeCloseTo(expected[i]!.score, CLOSE))
  }
}

/** The cleaned rows the dashboard computes from, grouped by every chart dimension, against the oracle. */
async function expectBreakdownsMatch(request: APIRequestContext, table: variants.Table) {
  const dataset = (await (await request.get('/api/dataset')).json()) as Dataset
  const { rows } = toRows(table)
  const appRows: oracle.Row[] = dataset.rows.map((r) => ({
    ...r,
    qty: r.qty_carton,
    price: r.price_per_carton_idr,
    gross: r.gross_sales_idr,
    discount: r.discount_idr,
    net: r.net_sales_idr,
  }))
  const dims: [string, (r: oracle.Row) => string][] = [
    ['region', (r) => r.region],
    ['brand', (r) => r.brand],
    ['branch', (r) => r.branch],
    ['outlet type', (r) => r.outlet_type],
    ['month', (r) => r.date.slice(0, 7)],
    ['salesman', (r) => r.salesman],
    ['sku', (r) => r.sku],
    ['outlet', (r) => r.outlet_id],
    ['region x brand', (r) => `${r.region} / ${r.brand}`],
  ]
  for (const [name, key] of dims) {
    expect(oracle.ranked(oracle.netBy(appRows, key)), `net by ${name}`).toEqual(oracle.ranked(oracle.netBy(rows, key)))
  }
}

test('the oracle itself reproduces PRD §8 AC2', () => {
  const table = variants.sampleTable()
  const { rows, duplicateRowNumbers } = toRows(table)
  const tot = oracle.totals(rows)
  expect([table.length, rows.length, duplicateRowNumbers]).toEqual([GOLDEN.rowsRead, GOLDEN.rowsClean, GOLDEN.duplicateRows])
  expect(tot).toEqual({
    net: GOLDEN.net,
    gross: GOLDEN.gross,
    discount: GOLDEN.discount,
    invoices: GOLDEN.invoices,
    outlets: GOLDEN.outlets,
    returnLines: GOLDEN.returnLines,
    returnNet: GOLDEN.returnNet,
  })
  expect(oracle.mom(rows)).toMatchObject({ current: GOLDEN.oct, baseline: GOLDEN.sep })
  expect(Object.fromEntries(oracle.netBy(rows, (r) => r.region))).toEqual(GOLDEN.regions)
  const weak = oracle.weakestDecline(rows)
  expect(weak.outlets.map((o) => [o.outletId, o.baseline, o.current, +o.momPct.toFixed(1), +o.score.toFixed(1)])).toEqual(
    GOLDEN.weakest.map((w) => [w.id, w.sep, w.oct, w.mom, w.score]),
  )
  expect(weak.newOutletIds).toEqual([GOLDEN.newOutlet])
  expect(Object.fromEntries([...weak.peerMedians].map(([k, v]) => [k, +v.toFixed(1)]))).toEqual({
    Grosir: -1.9,
    Warung: 7.3,
    'Toko Kelontong': 14.5,
    Minimarket: -0.1,
  })
})

test('sample via the push API: every number and breakdown matches the oracle', async ({ request }) => {
  const table = variants.sampleTable()
  const body = await push(request, variants.sampleCsv(table))
  expectResponseMatches(body, table)
  expect(body.quality.duplicatesRemoved).toBe(GOLDEN.duplicates)
  expect(body.quality.valuesFixed.reduce((n, f) => n + f.count, 0)).toBe(10)
  expect(body.quality.unmapped).toEqual([])
  await expectBreakdownsMatch(request, table)
})

const FILTERS: oracle.OracleFilters[] = [
  { regions: ['Jawa Barat'] },
  { brands: ['Sukro'] },
  { regions: ['Jawa Barat'], brands: ['Sukro'] },
  { outletTypes: ['Warung'] },
  { branches: ['Medan', 'Bandung'] },
  { salesmen: ['Unassigned'] },
  { dateFrom: '2026-10-01', dateTo: '2026-10-15' },
  // Ends mid-October: the comparison must switch to day 1..15 of both months.
  { dateFrom: '2026-09-01', dateTo: '2026-10-15' },
  { regions: ['Jawa Barat'], brands: ['Sukro'], dateFrom: '2026-10-01', dateTo: '2026-10-15' },
]

for (const filters of FILTERS) {
  test(`summary facts under filters ${JSON.stringify(filters)}`, async ({ request }) => {
    const rows = oracle.applyFilters(toRows(variants.sampleTable()).rows, filters)
    const res = await request.post('/api/summary', { data: { filters, lang: 'en' } })
    expect(res.status()).toBe(200)
    const { facts, summary } = (await res.json()) as SummaryResponse
    const value = (k: string) => facts[k]?.value

    expect(value('total_net')).toBe(oracle.totals(rows).net)
    const mom = oracle.mom(rows).pct
    if (mom === null) expect(facts.mom_pct).toBeUndefined()
    else expect(value('mom_pct') as number).toBeCloseTo(mom, CLOSE)
    expect(value('return_net')).toBe(oracle.totals(rows).returnNet)

    const regions = oracle.ranked(oracle.netBy(rows, (r) => r.region))
    if (regions.length >= 2) {
      expect([value('top_region'), value('top_region_net')]).toEqual(regions[0])
      const slowest = [...oracle.momByGroup(rows, (r) => r.region)]
        .filter((e): e is [string, number] => e[1] !== null)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]
      if (slowest) expect(value('weakest_region')).toBe(slowest[0])
    }
    const brands = oracle.ranked(oracle.netBy(rows, (r) => r.brand))
    expect(value('top_brand')).toBe(brands[0]![0])
    expect(value('top_brand_share_pct') as number).toBeCloseTo((brands[0]![1] / oracle.totals(rows).net) * 100, CLOSE)

    const decline = oracle.periods(rows).baseline !== null
    const weak = decline ? oracle.weakestDecline(rows).outlets : oracle.weakestLowest(rows)
    expect(value('weak_count')).toBe(weak.length)
    weak.forEach((o, i) => {
      expect(value(`weak_${i + 1}_name`), `weak #${i + 1}`).toBe(o.name)
      if (decline) expect(value(`weak_${i + 1}_pct`) as number).toBeCloseTo((o as oracle.OracleOutlet).momPct, CLOSE)
    })
    expect(summary).not.toMatch(/[{}]/)
  })
}

test('messy export (renamed + shuffled columns, ";", BOM, CRLF, 1.234.567, Rp, DD/MM/YYYY, region spellings) gives the golden numbers', async ({ request }) => {
  const body = await push(request, variants.messyExport())
  expectResponseMatches(body, variants.sampleTable())
  expect(body.kpis.netSales).toBe(GOLDEN.net)
  expect(body.quality.unmapped).toEqual([])
  await expectBreakdownsMatch(request, variants.sampleTable())
})

test('blank salesman rows become "Unassigned" and keep their sales', async ({ request }) => {
  const table = variants.withBlankSalesman('OUT1022')
  const body = await push(request, variants.sampleCsv(table))
  expectResponseMatches(body, table)
  const blank = table.filter((c) => c[variants.COL('salesman')]!.trim() === '').length
  expect(body.quality.missingSalesman).toBe(blank)
  expect(body.weakestOutlets[0]).toMatchObject({ outletId: 'OUT1022', salesman: 'Unassigned' })
  await expectBreakdownsMatch(request, table)
})

test('a lapsed outlet (no current-month sales) ranks at -100%', async ({ request }) => {
  const table = variants.withLapsedOutlet('OUT1004')
  const body = await push(request, variants.sampleCsv(table))
  expectResponseMatches(body, table)
  const lapsed = body.weakestOutlets.find((o) => o.outletId === 'OUT1004')
  expect(lapsed?.momPct).toBe(-100)
  expect(lapsed?.current).toBe(0)
})

test('a partial current month compares day 1..15 of both months', async ({ request }) => {
  const table = variants.partialCurrentMonth('2026-10-15')
  const body = await push(request, variants.sampleCsv(table))
  expect(body.periods.comparableDay).toBe(15)
  expectResponseMatches(body, table)
  await expectBreakdownsMatch(request, table)
})

test('a single month of data ranks outlets by "lowest vs peers"', async ({ request }) => {
  const table = variants.singleMonth('2026-10')
  const body = await push(request, variants.sampleCsv(table))
  expect(body.periods.baseline).toBeNull()
  expect(body.kpis.momPct).toBeNull()
  expectResponseMatches(body, table)
})

// QA-03: a file with the sample's own 15 headers reuses the saved column and value fixes, but its date and number
// formats are detected from the file itself.
const NUMERIC = (['qty_carton', 'price_per_carton_idr', 'gross_sales_idr', 'discount_idr', 'net_sales_idr'] as const).map(variants.COL)
const idThousands = (v: string) => `${Number(v) < 0 ? '-' : ''}${Math.abs(Number(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

test('same headers, Indonesian thousands (1.641.600) and ";": still the golden numbers', async ({ request }) => {
  const table = variants.sampleTable().map((c) => c.map((v, i) => (NUMERIC.includes(i) ? idThousands(v) : v)))
  const body = await push(request, variants.toCsv(oracle.HEADERS, table, ';'))
  expect(body.quality.unparseable).toEqual([])
  expect(body.kpis.netSales).toBe(GOLDEN.net)
})

test('same headers, DD/MM/YYYY dates: still the golden numbers', async ({ request }) => {
  const table = variants.sampleTable().map((c) => {
    const [y, m, d] = c[0]!.split('-')
    return [`${d}/${m}/${y}`, ...c.slice(1)]
  })
  const body = await push(request, variants.toCsv(oracle.HEADERS, table))
  expect(body.kpis.netSales).toBe(GOLDEN.net)
})
