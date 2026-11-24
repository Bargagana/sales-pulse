import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import { ChartCard } from '@/components/layout'
import { apexBase, FILL_GAP_STROKE, heatmapRanges, mergeOptions } from '@/theme'
import type { Matrix } from '../model/views'
import { ApexChart } from './ApexChart'
import { escapeHtml, useEmptyState, useFormatters, type ChartBaseProps, type PointRef } from './common'

const MAX_BRANDS = 8

interface HeatmapProps extends ChartBaseProps {
  data: Matrix
  onSelect: (region: string, brand: string) => void
}

/** Folds brand columns past the 8th into one "Other" column, keeping each region's total intact. */
function foldColumns(data: Matrix, otherLabel: string): Matrix {
  if (data.cols.length <= MAX_BRANDS) return data
  return {
    rows: data.rows,
    cols: [...data.cols.slice(0, MAX_BRANDS), otherLabel],
    values: data.values.map((row) => [...row.slice(0, MAX_BRANDS), row.slice(MAX_BRANDS).reduce((s, v) => s + v, 0)]),
  }
}

/** "Which brand is strong in which region?" Region x brand net sales, one blue ramp for magnitude. */
export function RegionBrandHeatmap({ data, onSelect, lang, isPhone, onClearFilters }: HeatmapProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const grid = useMemo(() => foldColumns(data, t('charts.other')), [data, t])
  const height = Math.max(240, grid.rows.length * 44 + 70)

  // Apex draws the first series at the bottom, so regions go in reversed: the biggest ends up on top.
  const series = useMemo(
    () =>
      grid.rows
        .map((region, i) => ({ name: region, data: grid.cols.map((brand, j) => ({ x: brand, y: grid.values[i]![j]! })) }))
        .reverse(),
    [grid],
  )

  const options = useMemo<ApexOptions>(() => {
    const max = Math.max(0, ...grid.values.flat())
    const otherLabel = t('charts.other')
    return mergeOptions(apexBase(lang), {
      chart: {
        type: 'heatmap',
        events: {
          dataPointSelection: (_e, _c, opts?: PointRef) => {
            if (!opts) return
            const region = series[opts.seriesIndex]?.name
            const brand = grid.cols[opts.dataPointIndex]
            if (region && brand && brand !== otherLabel) onSelect(region, brand)
          },
        },
      },
      plotOptions: { heatmap: { radius: 2, enableShades: false, colorScale: { ranges: heatmapRanges(max) } } },
      stroke: FILL_GAP_STROKE,
      legend: { show: false },
      dataLabels: { enabled: !isPhone, formatter: (v: number) => (v === 0 ? '' : fmt.short(v)) },
      xaxis: { labels: { rotate: -40, trim: false, hideOverlappingLabels: false } },
      yaxis: { labels: { formatter: (v: number | string) => String(v), maxWidth: 120 } },
      grid: { yaxis: { lines: { show: false } } },
      tooltip: {
        custom: ({ seriesIndex, dataPointIndex }: PointRef) => {
          const s = series[seriesIndex]!
          const cell = s.data[dataPointIndex]!
          return `<div class="px-3 py-2"><div class="font-semibold">${escapeHtml(s.name)} · ${escapeHtml(cell.x)}</div><div>${escapeHtml(fmt.idr(cell.y))}</div></div>`
        },
      },
    })
  }, [fmt, grid, isPhone, lang, onSelect, series, t])

  return (
    <ChartCard
      title={t('charts.heatmap.title')}
      question={t('charts.heatmap.question')}
      status={grid.rows.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={height}
      span={2}
      footer={t('charts.heatmap.footer')}
    >
      {/* Eight brand columns do not fit 375px; the grid scrolls inside its card instead of the page. */}
      <div className="-mx-1 overflow-x-auto">
        <div className="min-w-[560px] md:min-w-0">
          <ApexChart type="heatmap" series={series} options={options} height={height} />
        </div>
      </div>
    </ChartCard>
  )
}
