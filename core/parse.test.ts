import { describe, expect, it } from 'vitest'
import { parseCsv, profileTable } from './index'
import { parseDate, parseNumber } from './values'

describe('parseCsv', () => {
  it.each([
    [',', 'a,b,c\n1,2,3\n'],
    [';', 'a;b;c\n1;2;3\n'],
    ['\t', 'a\tb\tc\n1\t2\t3\n'],
  ] as const)('detects the %j delimiter', (delimiter, text) => {
    expect(parseCsv(text)).toEqual({ headers: ['a', 'b', 'c'], rows: [['1', '2', '3']], delimiter })
  })

  it('ignores separators inside a quoted header when detecting the delimiter', () => {
    expect(parseCsv('"a;b",c,d\n1,2,3').delimiter).toBe(',')
  })

  it('strips a UTF-8 BOM and handles CRLF', () => {
    const table = parseCsv('﻿date,net\r\n2026-09-01,10\r\n')
    expect(table.headers).toEqual(['date', 'net'])
    expect(table.rows).toEqual([['2026-09-01', '10']])
  })

  it('reads quoted fields with separators, escaped quotes and line breaks', () => {
    const table = parseCsv('name,net\n"Toko ""Jaya"", Bandung","1,234,567"\n"multi\nline",5\n')
    expect(table.rows).toEqual([
      ['Toko "Jaya", Bandung', '1,234,567'],
      ['multi\nline', '5'],
    ])
  })

  it('skips fully empty lines, including lines of bare separators', () => {
    const table = parseCsv('\n\na,b\n\n1,2\n,\n  \n3,4\n\n')
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('pads short rows and drops empty cells from a trailing separator', () => {
    expect(parseCsv('a,b,c\n1,2\n4,5,6,\n').rows).toEqual([
      ['1', '2', ''],
      ['4', '5', '6'],
    ])
  })

  it('gives blank and repeated headers unique names', () => {
    expect(parseCsv('a,,a\n1,2,3').headers).toEqual(['a', 'column_2', 'a (2)'])
  })

  it('trims header whitespace', () => {
    expect(parseCsv(' date , net \n1,2').headers).toEqual(['date', 'net'])
  })

  it.each([
    ['', /empty/],
    ['﻿  \n\n', /empty/],
    ['a,b,c\n', /no data rows/],
    ['just one column\nvalue', /separator/],
    ['a,b\n"unclosed,2\n', /double quote/],
    ['a,b\n1,2,3\n', /Data row 1 has 3 values but the header has 2/],
  ])('rejects %j with a readable error', (text, message) => {
    expect(() => parseCsv(text)).toThrow(message)
  })
})

describe('profileTable', () => {
  const rows = Array.from({ length: 12 }, (_, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, i % 3 === 0 ? 'Jabar' : 'Jawa Barat', `Rp ${i}.000`, `INV${i}`])
  const profile = profileTable({ headers: ['date', 'region', 'net', 'invoice'], rows, delimiter: ',' })

  it('keeps headers, at most 5 sample rows and the row count', () => {
    expect(profile.headers).toEqual(['date', 'region', 'net', 'invoice'])
    expect(profile.sampleRows).toEqual(rows.slice(0, 5))
    expect(profile.rowCount).toBe(12)
  })

  it('lists distinct values with counts only for text columns, most frequent first', () => {
    expect(Object.keys(profile.distinctValues)).toEqual(['region', 'invoice'])
    expect(profile.distinctValues.region).toEqual([
      { value: 'Jawa Barat', count: 8 },
      { value: 'Jabar', count: 4 },
    ])
  })

  it('caps distinct values at 300 per column', () => {
    const many = Array.from({ length: 400 }, (_, i) => [`Outlet ${i}`])
    expect(profileTable({ headers: ['outlet'], rows: many, delimiter: ',' }).distinctValues.outlet).toHaveLength(300)
  })
})

describe('parseNumber', () => {
  it.each([
    ['1725966000', 'plain', 1725966000],
    ['12.5', 'plain', 12.5],
    ['-528000', 'plain', -528000],
    ['1.725.966.000', 'id', 1725966000],
    ['1.234,5', 'id', 1234.5],
    ['Rp 1.234.567', 'id', 1234567],
    ['Rp-528.000', 'id', -528000],
    ['-Rp 528.000', 'id', -528000],
    ['(528.000)', 'id', -528000],
    ['rp.10.000', 'id', 10000],
    ['1,234,567.5', 'en', 1234567.5],
    ['IDR 528,000', 'en', 528000],
    [' 42 ', 'plain', 42],
  ] as const)('%j as %s -> %d', (text, format, expected) => {
    expect(parseNumber(text, format)).toBe(expected)
  })

  it.each([
    ['', 'plain'],
    ['abc', 'plain'],
    ['1.234.567', 'plain'],
    ['12.34', 'id'],
    ['1.23.456', 'id'],
    ['1,234,567', 'id'],
    ['1,23', 'en'],
    ['12-3', 'plain'],
  ] as const)('%j as %s is rejected rather than guessed', (text, format) => {
    expect(parseNumber(text, format)).toBeNull()
  })
})

describe('parseDate', () => {
  it.each([
    ['2026-09-01', 'YYYY-MM-DD', '2026-09-01'],
    ['2026-9-1', 'YYYY-MM-DD', '2026-09-01'],
    ['2026-09-01 00:00:00', 'YYYY-MM-DD', '2026-09-01'],
    ['2026-09-01T00:00:00Z', 'YYYY-MM-DD', '2026-09-01'],
    ['01/09/2026', 'DD/MM/YYYY', '2026-09-01'],
    ['1/9/2026', 'DD/MM/YYYY', '2026-09-01'],
    ['01-09-2026', 'DD-MM-YYYY', '2026-09-01'],
    ['09/01/2026', 'MM/DD/YYYY', '2026-09-01'],
    ['29/02/2028', 'DD/MM/YYYY', '2028-02-29'],
  ] as const)('%j as %s -> %s', (text, format, expected) => {
    expect(parseDate(text, format)).toBe(expected)
  })

  it.each([
    ['31/02/2026', 'DD/MM/YYYY'],
    ['29/02/2026', 'DD/MM/YYYY'],
    ['13/13/2026', 'DD/MM/YYYY'],
    ['2026-09-01', 'DD/MM/YYYY'],
    ['01/09/2026', 'YYYY-MM-DD'],
    ['', 'YYYY-MM-DD'],
    ['next tuesday', 'YYYY-MM-DD'],
  ] as const)('%j as %s is rejected', (text, format) => {
    expect(parseDate(text, format)).toBeNull()
  })
})
