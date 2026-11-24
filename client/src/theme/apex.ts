import type { ApexOptions } from 'apexcharts'
import { formatIdr, formatInt, formatPct } from '@core/index'
import type { Lang } from '@core/types'
import { CATEGORICAL, FONT_FAMILY, ink } from './tokens'

type ApexLocale = NonNullable<NonNullable<ApexOptions['chart']>['locales']>[number]

// Copied from apexcharts/dist/locales: the package's export map does not expose those JSON files.
const APEX_LOCALES: Record<Lang, ApexLocale> = {
  id: {
    name: 'id',
    options: {
      months: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
      shortMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
      days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
      shortDays: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
      toolbar: {
        selectionZoom: 'Perbesar pilihan',
        zoomIn: 'Perbesar',
        zoomOut: 'Perkecil',
        pan: 'Geser',
        reset: 'Atur ulang zoom',
      },
    },
  },
  en: {
    name: 'en',
    options: {
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      shortMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      shortDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      toolbar: {
        selectionZoom: 'Zoom to selection',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out',
        pan: 'Pan',
        reset: 'Reset zoom',
      },
    },
  },
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

const LOCALE: Record<Lang, string> = { id: 'id-ID', en: 'en-US' }

/**
 * Number formatters bound to a language. Tooltips and data labels use core's formatIdr (the same text as the
 * summary); axis ticks and heatmap cells use Intl compact notation ("Rp 100 jt", "IDR 100M"), because
 * "Rp 100 juta" ticks collide on a phone-width axis.
 */
export function chartFormatters(lang: Lang) {
  const axis = new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 })
  const short = new Intl.NumberFormat(LOCALE[lang], { notation: 'compact', maximumFractionDigits: 1 })
  return {
    idr: (v: number) => formatIdr(v, lang),
    idrCompact: (v: number) => formatIdr(v, lang, { compact: true }),
    idrAxis: (v: number) => axis.format(v),
    /** No currency: for dense cells (heatmap) where the card title already says Rp. */
    short: (v: number) => short.format(v),
    pct: (v: number) => formatPct(v, lang),
    int: (v: number) => formatInt(v, lang),
  }
}

/** 2px card-coloured gap between touching fills (donut slices, treemap tiles, stacked segments). */
export const FILL_GAP_STROKE: NonNullable<ApexOptions['stroke']> = { show: true, width: 2, colors: [ink.surface] }

/**
 * Shared ApexCharts defaults. Every chart starts from this and overrides only what its question needs:
 * `mergeOptions(apexBase(lang), { chart: { type: 'bar' }, ... })`.
 * Values default to IDR; override `yaxis.labels.formatter` / `tooltip.y.formatter` for counts or percentages.
 */
export function apexBase(lang: Lang): ApexOptions {
  const fmt = chartFormatters(lang)
  const axisLabelStyle = { colors: ink.axis, fontSize: '12px', fontFamily: FONT_FAMILY }
  const animate = !prefersReducedMotion()

  return {
    chart: {
      fontFamily: FONT_FAMILY,
      foreColor: ink.axis,
      background: 'transparent',
      locales: [APEX_LOCALES.id, APEX_LOCALES.en],
      defaultLocale: lang,
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      redrawOnParentResize: true,
      // Short transitions help the eye follow a cross-filter change; entrance choreography does not.
      animations: {
        enabled: animate,
        speed: 250,
        animateGradually: { enabled: false },
        dynamicAnimation: { enabled: animate, speed: 250 },
      },
    },
    colors: [...CATEGORICAL],
    dataLabels: {
      enabled: false,
      style: { fontFamily: FONT_FAMILY, fontSize: '12px', fontWeight: 600 },
      dropShadow: { enabled: false },
    },
    grid: {
      borderColor: ink.grid,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { top: 0, right: 8, bottom: 0, left: 8 },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      fontSize: '12px',
      fontFamily: FONT_FAMILY,
      labels: { colors: ink.secondary },
      itemMargin: { horizontal: 8, vertical: 4 },
    },
    // Line/area default. Bars, donut, treemap and heatmap override with FILL_GAP_STROKE.
    stroke: { width: 2, curve: 'straight', lineCap: 'round' },
    markers: { size: 0, strokeWidth: 2, strokeColors: ink.surface, hover: { size: 5 } },
    fill: { opacity: 1 },
    states: {
      hover: { filter: { type: 'darken' } },
      active: { filter: { type: 'none' } },
    },
    plotOptions: {
      bar: { borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '60%', barHeight: '70%' },
      pie: { expandOnClick: false, donut: { size: '68%' } },
      heatmap: { radius: 2, enableShades: false },
      treemap: { enableShades: false },
    },
    tooltip: {
      theme: 'light',
      style: { fontSize: '12px', fontFamily: FONT_FAMILY },
      y: { formatter: (v: number) => fmt.idr(v) },
    },
    xaxis: {
      axisBorder: { show: true, color: ink.baseline },
      axisTicks: { show: false },
      labels: { style: axisLabelStyle, hideOverlappingLabels: true },
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: { style: axisLabelStyle, formatter: (v: number) => fmt.idrAxis(v) },
    },
    noData: { text: '' }, // ChartCard renders the empty state, with a reason and an action
  }
}

type Plain = Record<string, unknown>
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/**
 * Deep merge for chart option objects. Objects merge key by key; arrays and functions replace, so
 * `colors: [...]` or `series: [...]` in the override always wins outright.
 */
export function mergeOptions<T extends object>(base: T, override: DeepPartial<T>): T {
  const out: Plain = { ...(base as Plain) }
  for (const [key, value] of Object.entries(override as Plain)) {
    if (value === undefined) continue
    const current = out[key]
    out[key] = isPlain(current) && isPlain(value) ? mergeOptions(current, value) : value
  }
  return out as T
}

export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T
