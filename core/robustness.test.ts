// PRD §8 AC3: messy variants of the sample must clean to the same golden numbers with the heuristic mapping alone.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GOLDEN } from './__fixtures__/golden'
import { readSampleCsv } from './__fixtures__/rows'
import { buildVariants } from './__fixtures__/variants'
import { breakdown, cleanTable, computeKpis, heuristicMapping, missingRequiredColumns, newOutlets, parseCsv, weakestOutlets } from './index'
import { round } from './util'

function expectGolden(csv: string) {
  const raw = parseCsv(csv)
  const mapping = heuristicMapping(raw)
  expect(missingRequiredColumns(mapping)).toEqual([])
  const { rows, quality } = cleanTable(raw, mapping)

  expect(quality.unparseable).toEqual([])
  expect(quality.rowsRead).toBe(1891)
  expect(quality.rowsClean).toBe(1888)
  expect(quality.duplicatesRemoved).toBe(3)
  expect(quality.returnLines).toBe(1)
  expect(quality.returnNet).toBe(-528_000)
  expect(quality.arithmeticMismatches).toEqual([])

  const kpis = computeKpis(rows)
  expect(kpis.netSales).toBe(1_725_966_000)
  expect(kpis.grossSales).toBe(1_756_320_000)
  expect(kpis.discount).toBe(30_354_000)
  expect(kpis.invoices).toBe(824)
  expect(kpis.activeOutlets).toBe(52)
  expect(round(kpis.momPct!, 2)).toBe(3.65)

  expect(Object.fromEntries(breakdown(rows, 'region').map((b) => [b.key, b.net]))).toEqual(GOLDEN.regions)
  expect(Object.fromEntries(breakdown(rows, 'brand').map((b) => [b.key, b.net]))).toEqual(GOLDEN.brands)

  const weakest = weakestOutlets(rows).map((o) => ({
    outletId: o.outletId,
    name: o.name,
    outletType: o.outletType,
    baseline: o.baseline,
    current: o.current,
    momPct: round(o.momPct, 1),
    score: round(o.score, 1),
  }))
  expect(weakest).toEqual(GOLDEN.weakest)
  expect(newOutlets(rows).map((o) => o.outletId)).toEqual(['OUT1047'])
}

describe('AC3 robustness: generated variants of data/data.csv', () => {
  const variants = buildVariants(readSampleCsv())

  it.each(variants.map((v) => [v.name, v.csv] as const))('%s reproduces the golden values', (_name, csv) => {
    expectGolden(csv)
  })

  it('the combined variant really is messy (sanity check on the generator)', () => {
    const combined = variants.at(-1)!.csv
    expect(combined.charCodeAt(0)).toBe(0xfeff)
    expect(combined).toContain(';')
    expect(combined).toMatch(/Rp \d{1,3}\.\d{3}/)
    expect(combined).toMatch(/\d{2}\/\d{2}\/2026/)
    expect(combined).toContain('Jateng')
    expect(combined).not.toContain('net_sales_idr')
  })
})

describe('AC3 robustness: checked-in fixture', () => {
  it('core/__fixtures__/sample-messy.csv reproduces the golden values', () => {
    const csv = readFileSync(fileURLToPath(new URL('./__fixtures__/sample-messy.csv', import.meta.url)), 'utf8')
    expectGolden(csv)
  })
})
