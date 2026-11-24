import Papa from 'papaparse'
import type { DataProfile, RawTable } from './types'
import { compareText } from './util'

const DELIMITERS: RawTable['delimiter'][] = [',', ';', '\t']
const DELIMITER_NAMES: Record<RawTable['delimiter'], string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }

/** Counts each candidate delimiter in the header line, ignoring anything inside double quotes. */
function detectDelimiter(text: string): RawTable['delimiter'] {
  const counts = new Map<RawTable['delimiter'], number>(DELIMITERS.map((d) => [d, 0]))
  let inQuotes = false
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === '\n' || char === '\r')) break
    else if (!inQuotes && counts.has(char as RawTable['delimiter'])) {
      const d = char as RawTable['delimiter']
      counts.set(d, counts.get(d)! + 1)
    }
  }
  let best: RawTable['delimiter'] = ','
  for (const d of DELIMITERS) if (counts.get(d)! > counts.get(best)!) best = d
  if (counts.get(best) === 0) {
    throw new Error('Could not find a column separator in the header row. Expected comma, semicolon or tab separated values.')
  }
  return best
}

/** Blank headers get a positional name and repeated headers a suffix, because the column map is keyed by header text. */
function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((raw, i) => {
    const base = raw.trim() || `column_${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

/** Auto-detects delimiter (, ; tab), strips BOM, handles quotes. Throws Error with a readable message on empty/garbled input. */
export function parseCsv(text: string): RawTable {
  const body = text.replace(/^﻿/, '')
  if (!body.trim()) throw new Error('The file is empty.')

  const firstContentLine = body.replace(/^(\s*\r?\n)+/, '')
  const delimiter = detectDelimiter(firstContentLine)
  const result = Papa.parse<string[]>(body, { delimiter, skipEmptyLines: 'greedy' })

  const fatal = result.errors.find((e) => e.type === 'Quotes')
  if (fatal) {
    const where = fatal.row === undefined ? '' : ` near row ${fatal.row + 1}`
    throw new Error(`The CSV could not be read${where}: ${fatal.message}. Check for an unclosed double quote.`)
  }

  const [headerRow, ...dataRows] = result.data
  if (!headerRow) throw new Error('The file is empty.')
  const headers = uniqueHeaders(headerRow)
  if (dataRows.length === 0) throw new Error('The file has a header row but no data rows.')

  const rows = dataRows.map((row, i) => {
    if (row.length > headers.length) {
      // A trailing separator ("a,b,c,") yields empty extra cells; anything else means the row is misaligned.
      if (row.slice(headers.length).some((cell) => cell.trim() !== '')) {
        throw new Error(
          `Data row ${i + 1} has ${row.length} values but the header has ${headers.length} columns (${DELIMITER_NAMES[delimiter]} separated). ` +
            'A value probably contains the separator without quotes.',
        )
      }
      return row.slice(0, headers.length)
    }
    return row.length < headers.length ? [...row, ...Array<string>(headers.length - row.length).fill('')] : row
  })

  return { headers, rows, delimiter }
}

const DISTINCT_CAP = 300
const SAMPLE_ROWS = 5

/** Numbers, money and dates: only digits plus separators, sign and an optional currency prefix. */
const NUMERIC_OR_DATE = /^[-+(]?\s*(rp\.?|idr)?\s*[-+]?\d[\d.,/\s:-]*\)?$/i

/** Profile for the LLM: headers, 5 sample rows, distinct values per non-numeric raw header (capped 300). */
export function profileTable(raw: RawTable): DataProfile {
  const distinctValues: DataProfile['distinctValues'] = {}

  raw.headers.forEach((header, col) => {
    const counts = new Map<string, number>()
    let nonEmpty = 0
    let numericLooking = 0
    for (const row of raw.rows) {
      const value = (row[col] ?? '').trim()
      if (!value) continue
      nonEmpty++
      if (NUMERIC_OR_DATE.test(value)) numericLooking++
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    // 95% rather than 100% so a few typos in a numeric column do not turn it into a "text" column.
    if (nonEmpty === 0 || numericLooking / nonEmpty >= 0.95) return
    distinctValues[header] = [...counts]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || compareText(a.value, b.value))
      .slice(0, DISTINCT_CAP)
  })

  return {
    headers: raw.headers,
    sampleRows: raw.rows.slice(0, SAMPLE_ROWS),
    rowCount: raw.rows.length,
    distinctValues,
  }
}
