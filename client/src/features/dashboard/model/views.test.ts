import { beforeAll, describe, expect, it } from 'vitest'
import { applyFilters, comparisonWindows, computeKpis, computePeriods } from '@core/index'
import type { Dataset, Filters } from '@core/types'
import { sampleDataset } from '../test-fixtures'
import { activeFilterCount, setDimension, toggleValue, without } from './filters'
import { biggestOutletChanges, buildViews, foldTail, indexDataset, type DatasetIndex } from './views'

let dataset: Dataset
let index: DatasetIndex

beforeAll(() => {
  dataset = sampleDataset()
  index = indexDataset(dataset)
})

describe('buildViews on data/data.csv', () => {
  it('shows the PRD golden totals with no filters', () => {
    const { kpi } = buildViews(dataset, index, {})
    expect(kpi.kpis.netSales).toBe(1_725_966_000)
    expect(kpi.kpis.invoices).toBe(824)
    expect(kpi.kpis.activeOutlets).toBe(52)
    expect(kpi.kpis.currentNet).toBe(878_448_600)
    expect(kpi.kpis.baselineNet).toBe(847_517_400)
    expect(kpi.kpis.momPct).toBeCloseTo(3.65, 2)
    expect(kpi.kpis.returnNet).toBe(-528_000)
  })

  it.each<[string, Filters]>([
    ['one region', { regions: ['Kalimantan'] }],
    ['two brands', { brands: ['Sukro', 'Deka'] }],
    ['outlet type and salesman', { outletTypes: ['Warung'], salesmen: ['Andi'] }],
    ['a date range inside October', { dateFrom: '2026-10-01', dateTo: '2026-10-15' }],
    ['a branch', { branches: ['Palembang'] }],
  ])('KPIs under %s equal core run directly on the filtered rows', (_name, filters) => {
    const { kpi, rows } = buildViews(dataset, index, filters)
    const expected = computeKpis(applyFilters(dataset.rows, filters))
    expect(kpi.kpis).toEqual(expected)
    expect(rows.length).toBeLessThan(dataset.rows.length)
  })

  it('matches the PRD region total when one region is selected', () => {
    expect(buildViews(dataset, index, { regions: ['Kalimantan'] }).kpi.kpis.netSales).toBe(144_240_400)
    expect(buildViews(dataset, index, { brands: ['Tos Tos'] }).kpi.kpis.netSales).toBe(285_909_300)
  })

  it('keeps every region in the region bar while a region is selected (cross-filter)', () => {
    const views = buildViews(dataset, index, { regions: ['Kalimantan'], brands: ['Sukro'] })
    expect(views.regions.map((r) => r.key)).toHaveLength(6)
    // ...but the brand filter still applies to it.
    const sukroOnly = applyFilters(dataset.rows, { brands: ['Sukro'] })
    expect(views.regions.reduce((s, r) => s + r.net, 0)).toBe(sukroOnly.reduce((s, r) => s + r.net_sales_idr, 0))
  })

  it('counts invoice and outlet changes in the same comparison windows as core', () => {
    const { kpi } = buildViews(dataset, index, {})
    const { current, baseline } = comparisonWindows(dataset.rows, computePeriods(dataset.rows))
    expect(kpi.invoices.current).toBe(new Set(current.map((r) => r.invoice_no)).size)
    expect(kpi.invoices.baseline).toBe(new Set(baseline.map((r) => r.invoice_no)).size)
    expect(kpi.invoices.current + kpi.invoices.baseline).toBe(824) // no invoice spans both months
    expect(kpi.outlets.current).toBe(new Set(current.map((r) => r.outlet_id)).size)
    expect(kpi.returns.momPct).toBeNull() // no returns in September, so there is nothing to compare with
  })

  it('daily sparklines add up to the KPI totals', () => {
    const { kpi } = buildViews(dataset, index, {})
    expect(kpi.daily.net.reduce((s, v) => s + v, 0)).toBe(1_725_966_000)
    expect(kpi.daily.returns.reduce((s, v) => s + v, 0)).toBe(528_000)
  })

  it('maps each branch to its region for the map colours', () => {
    expect(index.branchRegion.get('Palembang')).toBe('Sumatera')
    expect(index.branchRegion.get('Banjarmasin')).toBe('Kalimantan')
  })
})

describe('biggestOutletChanges', () => {
  it('lists the largest Rp changes from biggest fall to biggest rise, without new outlets', () => {
    const changes = biggestOutletChanges(dataset.rows, 10)
    expect(changes).toHaveLength(10)
    expect(changes.map((c) => c.change)).toEqual([...changes.map((c) => c.change)].sort((a, b) => a - b))
    expect(changes.some((c) => c.outletId === 'OUT1047')).toBe(false)
  })
})

describe('filter helpers', () => {
  it('toggles a value on and off and drops empty dimensions', () => {
    const on = toggleValue({}, 'regions', 'Sumatera')
    expect(on).toEqual({ regions: ['Sumatera'] })
    expect(toggleValue(on, 'regions', 'Sumatera')).toEqual({})
  })

  it('counts the date range once and ignores a chart own dimension with without()', () => {
    const f = setDimension({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }, 'brands', ['Sukro', 'Deka'])
    expect(activeFilterCount(f)).toBe(2)
    expect(without(f, 'brands')).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-31' })
  })

  it('folds the tail into one bucket', () => {
    const items = [5, 4, 3, 2, 1].map((n) => ({ key: `k${n}`, net: n, share: n / 15 }))
    const { top, other } = foldTail(items, 3)
    expect(top.map((i) => i.key)).toEqual(['k5', 'k4', 'k3'])
    expect(other?.net).toBe(3)
  })
})
