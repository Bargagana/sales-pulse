import { lazy, Suspense } from 'react'
import type { ApexOptions } from 'apexcharts'

export type ApexType = 'area' | 'bar' | 'donut' | 'heatmap' | 'treemap'

// ApexCharts is ~500 kB minified; as its own chunk the dashboard shell (KPIs, filters, table) paints first.
const Chart = lazy(() => import('react-apexcharts'))

/**
 * The one place the dashboard renders ApexCharts, so tests can mock a single module. Options and series must be
 * memoised by the caller: react-apexcharts diffs them by reference and redraws on every new object.
 */
export function ApexChart({ type, series, options, height }: { type: ApexType; series: ApexOptions['series']; options: ApexOptions; height: number }) {
  // updateOptions does not apply a new `defaultLocale` (date axes kept "Okt" after switching to English), so a
  // language change mounts a fresh chart.
  return (
    <Suspense fallback={<div style={{ height }} aria-hidden="true" />}>
      <Chart key={options.chart?.defaultLocale} type={type} series={series} options={options} height={height} width="100%" />
    </Suspense>
  )
}
