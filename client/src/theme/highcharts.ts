import type { LangOptions, Options } from 'highcharts'
import type { Lang } from '@core/types'
import { prefersReducedMotion } from './apex'
import { CATEGORICAL, FONT_FAMILY, ink } from './tokens'

/**
 * Highcharts `lang` is global, so it is applied with `Highcharts.setOptions` rather than per chart.
 * Call applyHighchartsLang before rendering, and key the map component on `lang` so it is rebuilt.
 */
export function highchartsLang(lang: Lang): LangOptions {
  if (lang === 'id') {
    return {
      locale: 'id-ID',
      decimalPoint: ',',
      thousandsSep: '.',
      numericSymbols: [' rb', ' jt', ' M', ' T'],
      zoomIn: 'Perbesar',
      zoomOut: 'Perkecil',
      resetZoom: 'Atur ulang zoom',
      loading: 'Memuat...',
      noData: 'Tidak ada data',
    }
  }
  return {
    locale: 'en-US',
    decimalPoint: '.',
    thousandsSep: ',',
    numericSymbols: ['K', 'M', 'B', 'T'],
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Reset zoom',
    loading: 'Loading...',
    noData: 'No data',
  }
}

function hasCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
}

export function applyHighchartsLang(highcharts: { setOptions(options: Options): unknown }, lang: Lang): void {
  highcharts.setOptions({ lang: highchartsLang(lang) })
}

/**
 * Per-chart theme with the same palette, font, grid and tooltip surface as apexBase.
 * Merge chart-specific options over it with mergeOptions from ./apex.
 */
export function highchartsTheme(): Options {
  const animation = prefersReducedMotion() ? false : { duration: 250 }
  // Zoom buttons are the map's only controls; on touch screens they get the full 44px target.
  const zoomButton = hasCoarsePointer() ? 44 : 28
  const labelStyle = { color: ink.axis, fontSize: '12px', fontFamily: FONT_FAMILY }

  return {
    colors: [...CATEGORICAL],
    chart: {
      backgroundColor: 'transparent',
      style: { fontFamily: FONT_FAMILY },
      spacing: [8, 8, 8, 8],
      animation,
    },
    // ChartCard renders the title and question in HTML, so the SVG stays label-free.
    title: { text: undefined },
    subtitle: { text: undefined },
    // Kept visible: the Highcharts licence for non-commercial use expects the credit (PRD risk table). As plain text:
    // the default links are 14 px tap targets on a phone (PRD AC7), and a stray tap would leave the dashboard.
    credits: { href: '', mapText: ' © {geojson.copyrightShort}', style: { color: ink.axis, fontSize: '10px', cursor: 'default' } },
    legend: {
      itemStyle: { color: ink.secondary, fontWeight: '500', fontSize: '12px' },
      itemHoverStyle: { color: ink.primary },
    },
    tooltip: {
      backgroundColor: ink.surface,
      borderColor: ink.border,
      borderRadius: 6,
      borderWidth: 1,
      shadow: { color: 'rgba(25, 25, 23, 0.08)', offsetX: 0, offsetY: 4, width: 8, opacity: 1 },
      padding: 10,
      style: { color: ink.primary, fontSize: '12px', fontFamily: FONT_FAMILY },
    },
    xAxis: { lineColor: ink.baseline, tickColor: ink.baseline, gridLineColor: ink.grid, labels: { style: labelStyle } },
    yAxis: { lineColor: ink.baseline, gridLineColor: ink.grid, labels: { style: labelStyle }, title: { text: undefined } },
    mapNavigation: {
      enabled: true,
      // Page scroll on a phone must scroll the page, not zoom the map.
      enableMouseWheelZoom: false,
      buttonOptions: {
        align: 'right',
        verticalAlign: 'bottom',
        width: zoomButton,
        height: zoomButton,
        theme: {
          fill: ink.surface,
          stroke: ink.border,
          'stroke-width': 1,
          r: 4,
          style: { color: ink.primary, fontSize: '16px' },
        },
      },
    },
    plotOptions: {
      series: {
        animation,
        states: { inactive: { opacity: 0.35 } },
      },
      map: {
        // Provinces no region covers stay muted and inert; the region map's series turns tracking back on for its own areas.
        nullColor: ink.muted,
        borderColor: ink.surface,
        borderWidth: 0.6,
        states: { hover: { enabled: false }, inactive: { opacity: 1 } },
        enableMouseTracking: false,
      },
      mapbubble: {
        minSize: 8,
        maxSize: '14%',
        // 2px card-coloured ring keeps overlapping branch bubbles in Java distinguishable.
        marker: { lineColor: ink.surface, lineWidth: 2, fillOpacity: 0.9 },
      },
    },
  }
}
