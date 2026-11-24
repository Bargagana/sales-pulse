import { describe, expect, it } from 'vitest'
import { formatIdr, formatInt, formatMonth, formatPct } from './index'
import { formatSharePct } from './format'

describe('formatIdr', () => {
  it.each([
    [1_725_966_000, 'Rp 1,73 miliar', 'IDR 1.73B'],
    [878_448_600, 'Rp 878,4 juta', 'IDR 878.4M'],
    [495_827_800, 'Rp 495,8 juta', 'IDR 495.8M'],
    [5_000_000, 'Rp 5 juta', 'IDR 5M'],
    [528_000, 'Rp 528.000', 'IDR 528,000'],
    [999, 'Rp 999', 'IDR 999'],
    [0, 'Rp 0', 'IDR 0'],
    [2_500_000_000_000, 'Rp 2,5 triliun', 'IDR 2.5T'],
    [-528_000, '-Rp 528.000', '-IDR 528,000'],
    [-54_900_000, '-Rp 54,9 juta', '-IDR 54.9M'],
  ])('%d -> %s / %s', (value, id, en) => {
    expect(formatIdr(value, 'id')).toBe(id)
    expect(formatIdr(value, 'en')).toBe(en)
  })

  it('promotes to the next unit when rounding reaches 1000', () => {
    expect(formatIdr(999_960_000, 'id')).toBe('Rp 1 miliar')
    expect(formatIdr(999_960_000, 'en')).toBe('IDR 1B')
  })

  it('never prints "-Rp 0"', () => {
    expect(formatIdr(-0.2, 'id')).toBe('Rp 0')
  })

  it('prints full digits with compact=false', () => {
    expect(formatIdr(1_725_966_000, 'id', { compact: false })).toBe('Rp 1.725.966.000')
    expect(formatIdr(1_725_966_000, 'en', { compact: false })).toBe('IDR 1,725,966,000')
    expect(formatIdr(-528_000.4, 'id', { compact: false })).toBe('-Rp 528.000')
  })
})

describe('formatPct', () => {
  it.each([
    [-54.94, '-54,9%', '-54.9%'],
    [3.6496, '+3,6%', '+3.6%'],
    [14.55, '+14,6%', '+14.6%'],
    [-100, '-100,0%', '-100.0%'],
    [0, '0,0%', '0.0%'],
    [-0.04, '0,0%', '0.0%'],
  ])('%d -> %s / %s', (value, id, en) => {
    expect(formatPct(value, 'id')).toBe(id)
    expect(formatPct(value, 'en')).toBe(en)
  })

  it('uses an ASCII hyphen-minus, so the summary is plain text everywhere', () => {
    expect(formatPct(-1, 'id').charCodeAt(0)).toBe(45)
  })

  it('formats shares without a plus sign', () => {
    expect(formatSharePct(42.86, 'id')).toBe('42,9%')
    expect(formatSharePct(42.86, 'en')).toBe('42.9%')
  })
})

describe('formatInt and formatMonth', () => {
  it('groups digits per locale', () => {
    expect(formatInt(1888, 'id')).toBe('1.888')
    expect(formatInt(1888, 'en')).toBe('1,888')
  })

  it('names months in both languages', () => {
    expect(formatMonth('2026-10', 'id')).toBe('Oktober 2026')
    expect(formatMonth('2026-10', 'en')).toBe('October 2026')
    expect(formatMonth('2026-05', 'id')).toBe('Mei 2026')
    expect(formatMonth('2026-08', 'id')).toBe('Agustus 2026')
  })

  it('returns anything that is not YYYY-MM unchanged', () => {
    expect(formatMonth('2026-13', 'en')).toBe('2026-13')
    expect(formatMonth('soon', 'id')).toBe('soon')
  })
})
