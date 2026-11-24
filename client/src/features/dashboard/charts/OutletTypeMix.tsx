import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import { ChartCard } from '@/components/layout'
import { apexBase, FILL_GAP_STROKE, mergeOptions, type CategoricalScale } from '@/theme'
import { formatShare, selectionColor } from '../model/format'
import type { Matrix } from '../model/views'
import { ApexChart } from './ApexChart'
import { ChartLegend } from './ChartLegend'
import { escapeHtml, useEmptyState, useFormatters, type ChartBaseProps, type PointRef } from './common'

/** Segments narrower than this get no in-bar label; the tooltip carries their value. */
const MIN_LABELLED_PCT = 12

interface OutletTypeMixProps extends ChartBaseProps {
  data: Matrix
  scale: CategoricalScale
  selected: string[] | undefined
  onSelect: (outletType: string) => void
}

/** "Which outlet types matter?" 100% stacked bars: each region's net sales split by outlet type. */
export function OutletTypeMix({ data, scale, selected, onSelect, lang, isPhone, onClearFilters }: OutletTypeMixProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const height = Math.max(200, data.rows.length * 44 + 56)

  // Returns can make a cell negative; a 100% stack has no room below zero, so those cells count as zero here.
  const series = useMemo(
    () => data.cols.map((type, j) => ({ name: type, data: data.rows.map((_, i) => Math.max(0, data.values[i]![j]!)) })),
    [data],
  )

  const options = useMemo<ApexOptions>(() => {
    const totals = data.rows.map((_, i) => series.reduce((sum, s) => sum + s.data[i]!, 0))
    return mergeOptions(apexBase(lang), {
      chart: {
        type: 'bar',
        stacked: true,
        stackType: '100%',
        events: { dataPointSelection: (_e, _c, opts?: PointRef) => opts && onSelect(data.cols[opts.seriesIndex]!) },
      },
      plotOptions: { bar: { horizontal: true, barHeight: '64%', borderRadius: 0 } },
      stroke: FILL_GAP_STROKE,
      colors: data.cols.map((type) => selectionColor(scale.color(type), type, selected)),
      legend: { show: false },
      dataLabels: {
        enabled: !isPhone,
        formatter: (v: number) => (v >= MIN_LABELLED_PCT ? formatShare(v / 100, lang) : ''),
        style: { colors: data.cols.map((type) => scale.labelColor(type)) },
      },
      xaxis: { categories: data.rows, tickAmount: 4, labels: { formatter: (v: string) => formatShare(Number(v) / 100, lang) } },
      yaxis: { labels: { formatter: (v: number | string) => String(v), maxWidth: isPhone ? 96 : 130 } },
      grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      tooltip: {
        custom: ({ seriesIndex, dataPointIndex }: PointRef) => {
          const value = series[seriesIndex]!.data[dataPointIndex]!
          const total = totals[dataPointIndex]!
          return `<div class="px-3 py-2"><div class="font-semibold">${escapeHtml(data.rows[dataPointIndex]!)} · ${escapeHtml(data.cols[seriesIndex]!)}</div><div>${escapeHtml(fmt.idr(value))} · ${escapeHtml(formatShare(total ? value / total : 0, lang))}</div></div>`
        },
      },
    })
  }, [data, fmt, isPhone, lang, onSelect, scale, selected, series])

  const legend = useMemo(
    () => data.cols.map((type) => ({ key: type, label: type, color: selectionColor(scale.color(type), type, selected) })),
    [data.cols, scale, selected],
  )

  return (
    <ChartCard
      title={t('charts.outletType.title')}
      question={t('charts.outletType.question')}
      status={data.rows.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={height}
      footer={t('charts.clickToFilter')}
    >
      <ChartLegend label={t('charts.legend', { chart: t('charts.outletType.title') })} items={legend} selected={selected} onSelect={onSelect} className="mb-1" />
      <ApexChart type="bar" series={series} options={options} height={height} />
    </ChartCard>
  )
}
