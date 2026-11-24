// Deterministic parsing of single cell values. Returns null instead of guessing, so callers can report the value.
import type { DateFormat, NumberFormat } from './types'

const INTEGER_PART: Record<NumberFormat, RegExp> = {
  plain: /^\d+$/,
  // Grouping is optional, but when present it must be in threes: "1.234.567" yes, "12.34" no.
  id: /^(\d{1,3}(\.\d{3})+|\d+)$/,
  en: /^(\d{1,3}(,\d{3})+|\d+)$/,
}
const DECIMAL_SEPARATOR: Record<NumberFormat, string> = { plain: '.', id: ',', en: '.' }

/** "Rp 1.234.567" / "-1,234.5" / "(528.000)" -> number, per format. Empty or malformed -> null. */
export function parseNumber(value: string, format: NumberFormat): number | null {
  let text = value.replace(/\s+/g, '')
  if (!text) return null

  let negative = false
  // Accounting style: "(528.000)" means -528.000.
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  }
  text = text.replace(/^(rp\.?|idr)/i, '')
  // "Rp-528.000" puts the sign after the currency.
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  }

  const sep = DECIMAL_SEPARATOR[format]
  const sepIndex = text.lastIndexOf(sep)
  const intPart = sepIndex === -1 ? text : text.slice(0, sepIndex)
  const fracPart = sepIndex === -1 ? '' : text.slice(sepIndex + 1)
  if (!INTEGER_PART[format].test(intPart)) return null
  if (sepIndex !== -1 && !/^\d+$/.test(fracPart)) return null

  const number = Number(`${intPart.replace(/[.,]/g, '')}.${fracPart || '0'}`)
  return negative ? -number : number
}

const DATE_PATTERNS: Record<DateFormat, { regex: RegExp; order: ['y' | 'm' | 'd', 'y' | 'm' | 'd', 'y' | 'm' | 'd'] }> = {
  'YYYY-MM-DD': { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['y', 'm', 'd'] },
  'DD/MM/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
  'DD-MM-YYYY': { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ['d', 'm', 'y'] },
  'MM/DD/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['m', 'd', 'y'] },
}

/** Spreadsheet exports often append a midnight time ("2026-09-01 00:00:00"); the time is irrelevant for daily sales. */
const TRAILING_TIME = /[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/

/** Parses a date in the given format into "YYYY-MM-DD". Impossible dates (31/02/2026) -> null. */
export function parseDate(value: string, format: DateFormat): string | null {
  const text = value.trim().replace(TRAILING_TIME, '')
  const { regex, order } = DATE_PATTERNS[format]
  const match = regex.exec(text)
  if (!match) return null
  const parts = { y: 0, m: 0, d: 0 }
  order.forEach((part, i) => (parts[part] = Number(match[i + 1])))
  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > daysInMonth(parts.y, parts.m)) return null
  return `${String(parts.y).padStart(4, '0')}-${pad2(parts.m)}-${pad2(parts.d)}`
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one. UTC avoids local-timezone surprises.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
