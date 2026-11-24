// PRD §8 AC2: golden values for data/data.csv, computed independently. Do not edit expected values to make a test pass.
import { beforeAll, describe, expect, it } from 'vitest'
import { GOLDEN } from './__fixtures__/golden'
import { readSampleCsv } from './__fixtures__/rows'
import {
  breakdown,
  cleanTable,
  computeKpis,
  computePeriods,
  heuristicMapping,
  newOutlets,
  parseCsv,
  weakestOutlets,
  type Dataset,
  type RawTable,
} from './index'
import { round } from './util'

let raw: RawTable
let dataset: Dataset

beforeAll(() => {
  raw = parseCsv(readSampleCsv())
  dataset = cleanTable(raw, heuristicMapping(raw))
})

describe('AC2 golden values on data/data.csv', () => {
  it('reads 1,891 rows and keeps 1,888 after removing 3 exact duplicates', () => {
    expect(dataset.quality.rowsRead).toBe(1891)
    expect(dataset.quality.rowsClean).toBe(1888)
    expect(dataset.rows).toHaveLength(1888)
    expect(dataset.quality.duplicatesRemoved).toBe(3)
    expect(dataset.quality.duplicateRowNumbers).toEqual([495, 913, 1873])
  })

  it('keeps exactly one return line: RTR900001, -Rp 528.000', () => {
    expect(dataset.quality.returnLines).toBe(1)
    expect(dataset.quality.returnNet).toBe(-528_000)
    const returns = dataset.rows.filter((r) => r.isReturn)
    expect(returns.map((r) => [r.invoice_no, r.net_sales_idr])).toEqual([['RTR900001', -528_000]])
  })

  it('folds 10 region spellings into 6 regions', () => {
    const regionIndex = raw.headers.indexOf('region')
    expect(new Set(raw.rows.map((r) => r[regionIndex])).size).toBe(10)
    expect(new Set(dataset.rows.map((r) => r.region))).toEqual(new Set(Object.keys(GOLDEN.regions)))
    expect(dataset.quality.valuesFixed.reduce((n, f) => n + f.count, 0)).toBe(10)
  })

  it('counts 824 invoices and 52 outlets by outlet_id', () => {
    const kpis = computeKpis(dataset.rows)
    expect(kpis.invoices).toBe(824)
    expect(kpis.activeOutlets).toBe(52)
  })

  it('totals gross, discount and net exactly', () => {
    const kpis = computeKpis(dataset.rows)
    expect(kpis.grossSales).toBe(1_756_320_000)
    expect(kpis.discount).toBe(30_354_000)
    expect(kpis.netSales).toBe(1_725_966_000)
  })

  it('compares September to October in full months: +3.65%', () => {
    const periods = computePeriods(dataset.rows)
    expect(periods).toEqual({ from: '2026-09-01', to: '2026-10-31', current: '2026-10', baseline: '2026-09', comparableDay: null })
    const kpis = computeKpis(dataset.rows)
    expect(kpis.baselineNet).toBe(847_517_400)
    expect(kpis.currentNet).toBe(878_448_600)
    expect(round(kpis.momPct!, 2)).toBe(3.65)
  })

  it('matches net sales for every region', () => {
    expect(Object.fromEntries(breakdown(dataset.rows, 'region').map((b) => [b.key, b.net]))).toEqual(GOLDEN.regions)
    expect(breakdown(dataset.rows, 'region').map((b) => b.key)).toEqual(Object.keys(GOLDEN.regions))
  })

  it('matches net sales for every brand', () => {
    expect(Object.fromEntries(breakdown(dataset.rows, 'brand').map((b) => [b.key, b.net]))).toEqual(GOLDEN.brands)
    expect(breakdown(dataset.rows, 'brand').map((b) => b.key)).toEqual(Object.keys(GOLDEN.brands))
  })

  it('matches the peer median MoM % of every outlet type', () => {
    const all = weakestOutlets(dataset.rows, { limit: 1000 })
    const medians = Object.fromEntries(all.map((o) => [o.outletType, round(o.peerMedianPct, 1)]))
    expect(medians).toEqual(GOLDEN.peerMedians)
  })

  it('ranks the 5 weakest outlets in the expected order', () => {
    const weakest = weakestOutlets(dataset.rows).map((o) => ({
      outletId: o.outletId,
      name: o.name,
      outletType: o.outletType,
      baseline: o.baseline,
      current: o.current,
      momPct: round(o.momPct, 1),
      score: round(o.score, 1),
    }))
    expect(weakest).toEqual(GOLDEN.weakest)
  })

  it('keeps #2 and #4 apart although both are called "Toko Anugerah"', () => {
    const shared = dataset.quality.sharedOutletNames.find((s) => s.name === 'Toko Anugerah')
    expect(shared?.outletIds).toEqual(['OUT1024', 'OUT1041', 'OUT1045'])
  })

  it('labels OUT1047 as the only new outlet and excludes it from the ranking', () => {
    expect(newOutlets(dataset.rows).map((o) => o.outletId)).toEqual(['OUT1047'])
    expect(weakestOutlets(dataset.rows, { limit: 1000 }).some((o) => o.outletId === 'OUT1047')).toBe(false)
  })

  it('places every branch of the sample on the map', () => {
    const branches = new Set(dataset.rows.map((r) => r.branch))
    expect(branches.size).toBe(13)
    expect(Object.keys(dataset.branchGeo).sort()).toEqual([...branches].sort())
  })
})
