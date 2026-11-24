import type { Lang } from './types'

const LOCALE: Record<Lang, string> = { id: 'id-ID', en: 'en-US' }
const CURRENCY_PREFIX: Record<Lang, string> = { id: 'Rp', en: 'IDR' }

/** Compact units, largest first. `decimals` keeps "Rp 1,73 miliar" and "Rp 878,4 juta" at a readable precision. */
const UNITS: Record<Lang, { size: number; suffix: string; decimals: number }[]> = {
  id: [
    { size: 1e12, suffix: ' triliun', decimals: 2 },
    { size: 1e9, suffix: ' miliar', decimals: 2 },
    { size: 1e6, suffix: ' juta', decimals: 1 },
  ],
  en: [
    { size: 1e12, suffix: 'T', decimals: 2 },
    { size: 1e9, suffix: 'B', decimals: 2 },
    { size: 1e6, suffix: 'M', decimals: 1 },
  ],
}

function formatNumber(value: number, lang: Lang, maxDecimals: number): string {
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: maxDecimals }).format(value)
}

/** id: "Rp 1,73 miliar" / "Rp 528.000"; en: "IDR 1.73B" / "IDR 528,000". compact=false prints full digits. */
export function formatIdr(value: number, lang: Lang, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? true
  const abs = Math.abs(value)
  // Avoid "-Rp 0" for values that round to zero.
  const sign = Math.round(abs) === 0 ? '' : value < 0 ? '-' : ''
  const prefix = CURRENCY_PREFIX[lang]

  if (compact) {
    const units = UNITS[lang]
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!
      if (abs < unit.size) continue
      const scaled = abs / unit.size
      const factor = 10 ** unit.decimals
      const rounded = Math.round(scaled * factor) / factor
      // 999.96 juta rounds to "1.000 juta"; show it as "1 miliar" instead.
      const bigger = units[i - 1]
      if (rounded >= 1000 && bigger) {
        const promoted = Math.round((abs / bigger.size) * 10 ** bigger.decimals) / 10 ** bigger.decimals
        return `${sign}${prefix} ${formatNumber(promoted, lang, bigger.decimals)}${bigger.suffix}`
      }
      return `${sign}${prefix} ${formatNumber(rounded, lang, unit.decimals)}${unit.suffix}`
    }
  }
  return `${sign}${prefix} ${formatNumber(Math.round(abs), lang, 0)}`
}

/** id: "-54,9%" / "+3,6%"; en: "-54.9%" / "+3.6%". Always signed, 1 decimal ("0,0%" for zero). */
export function formatPct(value: number, lang: Lang): string {
  return formatPctWithSign(value, lang, 'exceptZero')
}

/** Shares ("42,9% of sales") read wrong with a "+" sign, so they use this instead of formatPct. */
export function formatSharePct(value: number, lang: Lang): string {
  return formatPctWithSign(value, lang, 'auto')
}

function formatPctWithSign(value: number, lang: Lang, signDisplay: 'exceptZero' | 'auto'): string {
  const text = new Intl.NumberFormat(LOCALE[lang], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay,
  }).format(value)
  return `${text}%`
}

export function formatInt(value: number, lang: Lang): string {
  return formatNumber(Math.round(value), lang, 0)
}

const MONTHS: Record<Lang, string[]> = {
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}

/** "2026-10" -> id "Oktober 2026" / en "October 2026". Anything else is returned unchanged. */
export function formatMonth(month: string, lang: Lang): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  const name = match ? MONTHS[lang][Number(match[2]) - 1] : undefined
  return match && name ? `${name} ${match[1]}` : month
}
