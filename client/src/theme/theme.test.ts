import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SalesRow } from '@core/types'
import { UNMAPPED } from '@core/types'
import { mergeOptions } from './apex'
import { categoricalScale, datasetScales, deltaTone, heatmapRanges, sequentialColor } from './colors'
import { CATEGORICAL, OTHER_COLOR, SEQUENTIAL, ink } from './tokens'

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
const cssVar = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase()

describe('tokens', () => {
  it('match the CSS variables, so Apex, Highcharts and shadcn render the same colours', () => {
    expect(cssVar('foreground')).toBe(ink.primary)
    expect(cssVar('muted-foreground')).toBe(ink.secondary)
    expect(cssVar('card')).toBe(ink.surface)
    expect(cssVar('background')).toBe(ink.page)
    expect(cssVar('border')).toBe(ink.border)
    expect(cssVar('primary')).toBe(ink.accent)
    CATEGORICAL.forEach((hex, i) => expect(cssVar(`chart-${i + 1}`)).toBe(hex))
  })
})

describe('categoricalScale', () => {
  const regions = ['Sumatera', 'Jabodetabek', 'Kalimantan', 'Jawa Barat', 'Jawa Timur', 'Jawa Tengah']

  it('assigns slots by name, not by input order', () => {
    const a = categoricalScale(regions)
    const b = categoricalScale([...regions].reverse())
    for (const r of regions) expect(a.color(r)).toBe(b.color(r))
    expect(a.domain).toEqual(['Jabodetabek', 'Jawa Barat', 'Jawa Tengah', 'Jawa Timur', 'Kalimantan', 'Sumatera'])
    expect(a.color('Jabodetabek')).toBe(CATEGORICAL[0])
  })

  it('gives every name in the domain a distinct colour', () => {
    const scale = categoricalScale(regions)
    expect(new Set(regions.map(scale.color)).size).toBe(regions.length)
  })

  it('keeps colours when a filter shows only some entities', () => {
    const scale = categoricalScale(regions)
    expect(scale.colors(['Sumatera', 'Kalimantan'])).toEqual([scale.color('Sumatera'), scale.color('Kalimantan')])
  })

  it('paints Unmapped and unknown names grey', () => {
    const scale = categoricalScale([...regions, UNMAPPED])
    expect(scale.color(UNMAPPED)).toBe(OTHER_COLOR)
    expect(scale.color('Papua')).toBe(OTHER_COLOR)
    expect(scale.domain).not.toContain(UNMAPPED)
  })

  it('never cycles the palette past 8 entries', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Brand ${String.fromCharCode(65 + i)}`)
    const scale = categoricalScale(names)
    expect(scale.domain).toHaveLength(8)
    expect(scale.color('Brand J')).toBe(OTHER_COLOR)
  })
})

describe('datasetScales', () => {
  const row = (brand: string, net: number): SalesRow =>
    ({ region: 'Jawa Barat', brand, outlet_type: 'Warung', net_sales_idr: net }) as SalesRow

  it('keeps a colour for the 8 largest brands when there are more', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`B${i}`, (i + 1) * 100))
    const { brand } = datasetScales(rows)
    expect(brand.color('B0')).toBe(OTHER_COLOR) // smallest
    expect(brand.color('B8')).not.toBe(OTHER_COLOR)
  })
})

describe('heatmapRanges', () => {
  it('separates zero from small values and covers the max', () => {
    const ranges = heatmapRanges(700)
    expect(sequentialColor(0, 700)).toBe(ink.muted)
    expect(sequentialColor(1, 700)).toBe(SEQUENTIAL[100])
    expect(sequentialColor(700, 700)).toBe(SEQUENTIAL[700])
    expect(ranges).toHaveLength(8)
  })

  it('uses white text only on the dark steps', () => {
    const ranges = heatmapRanges(700)
    expect(ranges.find((r) => r.color === SEQUENTIAL[400])?.foreColor).toBe(ink.primary)
    expect(ranges.find((r) => r.color === SEQUENTIAL[500])?.foreColor).toBe('#ffffff')
  })

  it('handles an all-zero matrix', () => {
    expect(heatmapRanges(0)).toHaveLength(1)
  })
})

describe('deltaTone', () => {
  it('follows the sign, flipped for metrics where up is bad', () => {
    expect(deltaTone(3.65)).toBe('positive')
    expect(deltaTone(-54.9)).toBe('negative')
    expect(deltaTone(5, { positiveIsGood: false })).toBe('negative')
    expect(deltaTone(0)).toBe('neutral')
    expect(deltaTone(null)).toBe('neutral')
  })
})

describe('mergeOptions', () => {
  it('merges objects deeply and replaces arrays', () => {
    const base = { chart: { type: 'bar', toolbar: { show: false } }, colors: ['#000', '#111'] }
    const merged = mergeOptions(base, { chart: { type: 'line' }, colors: ['#fff'] })
    expect(merged).toEqual({ chart: { type: 'line', toolbar: { show: false } }, colors: ['#fff'] })
    expect(base.chart.type).toBe('bar')
  })
})
