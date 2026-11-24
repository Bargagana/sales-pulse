import { describe, expect, it } from 'vitest'
import { outletMonth, salesRow } from './__fixtures__/rows'
import {
  applyFilters,
  breakdown,
  computeKpis,
  computePeriods,
  dailySeries,
  matrix,
  monthlySeries,
  newOutlets,
  weakestOutlets,
} from './index'
import { momByGroup } from './metrics'

describe('applyFilters', () => {
  const rows = [
    salesRow({ date: '2026-09-30', region: 'Jawa Barat', brand: 'Sukro', outlet_type: 'Warung', salesman: 'Andi', branch: 'Bandung', sku: 'S-1', outlet_id: 'O1' }),
    salesRow({ date: '2026-10-01', region: 'Sumatera', brand: 'Roni', outlet_type: 'Grosir', salesman: 'Budi', branch: 'Medan', sku: 'R-1', outlet_id: 'O2' }),
    salesRow({ date: '2026-10-15', region: 'Sumatera', brand: 'Sukro', outlet_type: 'Warung', salesman: 'Andi', branch: 'Palembang', sku: 'S-2', outlet_id: 'O1' }),
  ]
  const dates = (filtered: typeof rows) => filtered.map((r) => r.date)

  it('filters by inclusive date range', () => {
    expect(dates(applyFilters(rows, { dateFrom: '2026-10-01', dateTo: '2026-10-15' }))).toEqual(['2026-10-01', '2026-10-15'])
    expect(dates(applyFilters(rows, { dateTo: '2026-09-30' }))).toEqual(['2026-09-30'])
  })

  it('filters by every dimension and combines them with AND', () => {
    expect(dates(applyFilters(rows, { regions: ['Sumatera'] }))).toEqual(['2026-10-01', '2026-10-15'])
    expect(dates(applyFilters(rows, { brands: ['Sukro'], regions: ['Sumatera'] }))).toEqual(['2026-10-15'])
    expect(dates(applyFilters(rows, { branches: ['Medan'] }))).toEqual(['2026-10-01'])
    expect(dates(applyFilters(rows, { outletTypes: ['Warung'] }))).toEqual(['2026-09-30', '2026-10-15'])
    expect(dates(applyFilters(rows, { salesmen: ['Budi'] }))).toEqual(['2026-10-01'])
    expect(dates(applyFilters(rows, { skus: ['S-1', 'R-1'] }))).toEqual(['2026-09-30', '2026-10-01'])
    expect(dates(applyFilters(rows, { outletIds: ['O1'] }))).toEqual(['2026-09-30', '2026-10-15'])
  })

  it('treats empty arrays as "no filter"', () => {
    expect(applyFilters(rows, { regions: [], brands: [] })).toHaveLength(3)
  })
})

describe('computePeriods', () => {
  it('uses full months when the current month ends on its last day', () => {
    expect(computePeriods([salesRow({ date: '2026-09-03' }), salesRow({ date: '2026-10-31' })])).toEqual({
      from: '2026-09-03',
      to: '2026-10-31',
      current: '2026-10',
      baseline: '2026-09',
      comparableDay: null,
    })
  })

  it('compares day 1..D when the current month is incomplete', () => {
    expect(computePeriods([salesRow({ date: '2026-09-30' }), salesRow({ date: '2026-10-15' })]).comparableDay).toBe(15)
  })

  it('knows February lengths', () => {
    expect(computePeriods([salesRow({ date: '2028-02-29' })]).comparableDay).toBeNull()
    expect(computePeriods([salesRow({ date: '2026-02-28' })]).comparableDay).toBeNull()
    expect(computePeriods([salesRow({ date: '2028-02-28' })]).comparableDay).toBe(28)
  })

  it('has no baseline with a single month, or when the previous month is missing', () => {
    expect(computePeriods([salesRow({ date: '2026-10-31' })]).baseline).toBeNull()
    expect(computePeriods([salesRow({ date: '2026-08-31' }), salesRow({ date: '2026-10-31' })]).baseline).toBeNull()
  })

  it('crosses the year boundary', () => {
    expect(computePeriods([salesRow({ date: '2025-12-31' }), salesRow({ date: '2026-01-31' })])).toMatchObject({ current: '2026-01', baseline: '2025-12' })
  })

  it('handles no rows', () => {
    expect(computePeriods([])).toEqual({ from: '', to: '', current: null, baseline: null, comparableDay: null })
  })
})

describe('computeKpis', () => {
  it('sums totals, counts invoices and outlets, and computes MoM %', () => {
    const kpis = computeKpis([
      salesRow({ date: '2026-09-10', invoice_no: 'A', outlet_id: 'O1', net_sales_idr: 100, gross_sales_idr: 110, discount_idr: 10 }),
      salesRow({ date: '2026-10-10', invoice_no: 'B', outlet_id: 'O1', net_sales_idr: 150, gross_sales_idr: 150 }),
      salesRow({ date: '2026-10-31', invoice_no: 'B', outlet_id: 'O2', net_sales_idr: -50, gross_sales_idr: -50, isReturn: true }),
    ])
    expect(kpis).toEqual({
      netSales: 200,
      grossSales: 210,
      discount: 10,
      invoices: 2,
      activeOutlets: 2,
      returnLines: 1,
      returnNet: -50,
      currentNet: 100,
      baselineNet: 100,
      momPct: 0,
    })
  })

  it('compares only day 1..D of both months when the current month is partial', () => {
    const kpis = computeKpis([
      salesRow({ date: '2026-09-05', net_sales_idr: 100 }),
      salesRow({ date: '2026-09-20', net_sales_idr: 900 }), // after day 10: outside the window
      salesRow({ date: '2026-10-10', net_sales_idr: 150 }),
    ])
    expect(kpis).toMatchObject({ netSales: 1150, baselineNet: 100, currentNet: 150, momPct: 50 })
  })

  it('has no MoM % without a baseline month', () => {
    expect(computeKpis([salesRow({ date: '2026-10-31' })])).toMatchObject({ currentNet: 100, baselineNet: null, momPct: null })
  })

  it('handles no rows', () => {
    expect(computeKpis([])).toMatchObject({ netSales: 0, invoices: 0, currentNet: null, momPct: null })
  })
})

describe('breakdown and matrix', () => {
  const rows = [
    salesRow({ region: 'A', brand: 'x', net_sales_idr: 10 }),
    salesRow({ region: 'B', brand: 'y', net_sales_idr: 30 }),
    salesRow({ region: 'A', brand: 'y', net_sales_idr: 20 }),
    salesRow({ region: 'C', brand: 'x', net_sales_idr: 30 }),
  ]

  it('sums net per key, sorted by net desc then key, with shares', () => {
    expect(breakdown(rows, 'region')).toEqual([
      { key: 'A', net: 30, share: 30 / 90 },
      { key: 'B', net: 30, share: 30 / 90 },
      { key: 'C', net: 30, share: 30 / 90 },
    ])
    expect(breakdown(rows, 'brand').map((b) => b.key)).toEqual(['y', 'x'])
  })

  it('builds a region x brand matrix ordered by totals', () => {
    expect(matrix(rows, 'region', 'brand')).toEqual({
      rows: ['A', 'B', 'C'],
      cols: ['y', 'x'],
      values: [
        [20, 10],
        [30, 0],
        [0, 30],
      ],
    })
  })

  it('gives zero shares when total net is zero', () => {
    expect(breakdown([salesRow({ net_sales_idr: 0 })], 'region')[0]!.share).toBe(0)
  })
})

describe('dailySeries and monthlySeries', () => {
  it('fills missing days with 0', () => {
    expect(dailySeries([salesRow({ date: '2026-10-30', net_sales_idr: 5 }), salesRow({ date: '2026-11-02', net_sales_idr: 7 }), salesRow({ date: '2026-10-30', net_sales_idr: 1 })])).toEqual([
      { date: '2026-10-30', net: 6 },
      { date: '2026-10-31', net: 0 },
      { date: '2026-11-01', net: 0 },
      { date: '2026-11-02', net: 7 },
    ])
  })

  it('fills missing months with 0', () => {
    expect(monthlySeries([salesRow({ date: '2025-11-03', net_sales_idr: 5 }), salesRow({ date: '2026-01-02', net_sales_idr: 7 })])).toEqual([
      { month: '2025-11', net: 5 },
      { month: '2025-12', net: 0 },
      { month: '2026-01', net: 7 },
    ])
  })

  it('returns [] for no rows', () => {
    expect(dailySeries([])).toEqual([])
    expect(monthlySeries([])).toEqual([])
  })
})

describe('weakestOutlets: decline vs peers', () => {
  const SEP = '2026-09-10'
  const OCT = '2026-10-31'
  const rows = [
    // Warung peers: +10%, -20%, -100% (lapsed) -> median -20%
    outletMonth('W1', 'Warung', SEP, 100), outletMonth('W1', 'Warung', OCT, 110),
    outletMonth('W2', 'Warung', SEP, 100), outletMonth('W2', 'Warung', OCT, 80),
    outletMonth('W3', 'Warung', SEP, 100),
    // Grosir peers: -50%, +50% -> median 0%
    outletMonth('G1', 'Grosir', SEP, 1000), outletMonth('G1', 'Grosir', OCT, 500),
    outletMonth('G2', 'Grosir', SEP, 1000), outletMonth('G2', 'Grosir', OCT, 1500),
    // New outlet: no baseline sales
    outletMonth('N1', 'Grosir', OCT, 10),
  ]

  it('scores MoM % against the median of the same outlet type, lowest first', () => {
    expect(weakestOutlets(rows, { limit: 10 }).map((o) => [o.outletId, o.momPct, o.peerMedianPct, o.score])).toEqual([
      ['W3', -100, -20, -80],
      ['G1', -50, 0, -50],
      ['W2', -20, -20, 0],
      ['W1', 10, -20, 30],
      ['G2', 50, 0, 50],
    ])
  })

  it('reports lapsed outlets at -100% with current 0 and the Rp change', () => {
    expect(weakestOutlets(rows, { limit: 1 })[0]).toMatchObject({ outletId: 'W3', baseline: 100, current: 0, change: -100, momPct: -100 })
  })

  it('excludes new outlets and lists them separately', () => {
    expect(weakestOutlets(rows, { limit: 10 }).some((o) => o.outletId === 'N1')).toBe(false)
    expect(newOutlets(rows)).toEqual([{ outletId: 'N1', name: 'Outlet N1' }])
  })

  it('breaks score ties by lower current net', () => {
    const tie = [
      outletMonth('A', 'Warung', SEP, 200), outletMonth('A', 'Warung', OCT, 100),
      outletMonth('B', 'Warung', SEP, 100), outletMonth('B', 'Warung', OCT, 50),
    ]
    expect(weakestOutlets(tie).map((o) => o.outletId)).toEqual(['B', 'A'])
  })

  it('returns 5 by default and honours limit', () => {
    expect(weakestOutlets(rows)).toHaveLength(5)
    expect(weakestOutlets(rows, { limit: 2 })).toHaveLength(2)
  })

  it('describes each outlet by its most frequent branch, region and salesman', () => {
    const outlet = [
      outletMonth('X', 'Warung', SEP, 100, { salesman: 'Andi', branch: 'Bandung' }),
      outletMonth('X', 'Warung', OCT, 50, { salesman: 'Budi', branch: 'Bandung' }),
      outletMonth('X', 'Warung', OCT, 10, { salesman: 'Budi', branch: 'Cirebon' }),
    ]
    expect(weakestOutlets(outlet)[0]).toMatchObject({ salesman: 'Budi', branch: 'Bandung', region: 'Jawa Barat', name: 'Outlet X' })
  })

  it('uses the comparable window when the current month is partial', () => {
    const partial = [outletMonth('P', 'Warung', '2026-09-05', 100), outletMonth('P', 'Warung', '2026-09-25', 900), outletMonth('P', 'Warung', '2026-10-10', 50)]
    expect(weakestOutlets(partial)[0]).toMatchObject({ baseline: 100, current: 50, momPct: -50 })
  })

  it('returns [] without a baseline month', () => {
    expect(weakestOutlets([outletMonth('A', 'Warung', OCT, 100)])).toEqual([])
    expect(newOutlets([outletMonth('A', 'Warung', OCT, 100)])).toEqual([])
  })
})

describe('weakestOutlets: lowest vs peers', () => {
  it('ranks net / median net of the outlet type and works with a single month', () => {
    const rows = [
      outletMonth('W1', 'Warung', '2026-10-01', 100),
      outletMonth('W2', 'Warung', '2026-10-01', 200),
      outletMonth('W3', 'Warung', '2026-10-01', 400),
      outletMonth('G1', 'Grosir', '2026-10-01', 1000),
      outletMonth('G2', 'Grosir', '2026-10-01', 3000),
    ]
    // Warung median 200, Grosir median 2000. W1 and G1 tie at 0.5; the lower net (W1) goes first.
    expect(weakestOutlets(rows, { mode: 'lowest', limit: 10 }).map((o) => [o.outletId, o.score])).toEqual([
      ['W1', 0.5],
      ['G1', 0.5],
      ['W2', 1],
      ['G2', 1.5],
      ['W3', 2],
    ])
  })
})

describe('momByGroup', () => {
  it('uses the overall periods, so a region without current sales is -100%', () => {
    const rows = [
      salesRow({ region: 'A', date: '2026-09-10', net_sales_idr: 100 }),
      salesRow({ region: 'B', date: '2026-09-10', net_sales_idr: 100 }),
      salesRow({ region: 'B', date: '2026-10-31', net_sales_idr: 120 }),
      salesRow({ region: 'C', date: '2026-10-31', net_sales_idr: 50 }),
    ]
    expect(momByGroup(rows, 'region')).toEqual([
      { key: 'A', current: 0, baseline: 100, momPct: -100 },
      { key: 'B', current: 120, baseline: 100, momPct: 20 },
      { key: 'C', current: 50, baseline: 0, momPct: null },
    ])
  })
})
