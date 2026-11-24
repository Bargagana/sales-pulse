import { formatSharePct } from '@core/index'
import type { Lang } from '@core/types'
import { LOCALE_TAG } from '@/i18n'
import { ink } from '@/theme'

/** A share of a total, given as a 0..1 fraction ("42,9%"). Unsigned, unlike changes, so it does not read like growth. */
export function formatShare(fraction: number, lang: Lang): string {
  return formatSharePct(fraction * 100, lang)
}

/** "0,4×" for the lowest-vs-peers ratio (outlet net ÷ median net of its type). */
export function formatRatio(ratio: number, lang: Lang): string {
  return `${new Intl.NumberFormat(LOCALE_TAG[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ratio)}×`
}

/** "1 Okt" / "Oct 1" for chart axes and tooltips. */
export function formatDay(isoDay: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${isoDay}T12:00:00Z`))
}

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/**
 * The 35 % "not selected" look from DESIGN.md §4 rule 8, pre-mixed with the card surface. A solid colour rather
 * than an alpha keeps Apex's hover filter and Highcharts' bubble ring working on it.
 */
export function dimmed(hex: string, strength = 0.35): string {
  const fg = hexToRgb(hex)
  const bg = hexToRgb(ink.surface)
  return `#${fg.map((c, i) => Math.round(c * strength + bg[i]! * (1 - strength)).toString(16).padStart(2, '0')).join('')}`
}

/** Colour for a value given the active selection of its dimension: full colour when nothing or it is selected. */
export function selectionColor(color: string, value: string, selected: readonly string[] | undefined): string {
  return !selected?.length || selected.includes(value) ? color : dimmed(color)
}
