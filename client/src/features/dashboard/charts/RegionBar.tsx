import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import type { Breakdown } from '@core/types'
import { ChartCard } from '@/components/layout'
import { apexBase, FILL_GAP_STROKE, mergeOptions, type CategoricalScale } from '@/theme'
import { formatShare, selectionColor } from '../model/format'
import { ApexChart } from './ApexChart'
import { escapeHtml, useEmptyState, useFormatters, type ChartBaseProps, type PointRef } from './common'

interface RegionBarProps extends ChartBaseProps {
  data: Breakdown[]
  scale: CategoricalScale
  selected: string[] | undefined
  onSelect: (region: string) => void
}

/** "Which region is biggest?" Sorted horizontal bars in region colours; doubles as the map's colour key. */
export function RegionBar({ data, scale, selected, onSelect, lang, isPhone, onClearFilters }: RegionBarProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const height = Math.max(200, data.length * 44 + 40)

  const series = useMemo(() => [{ name: t('charts.netSales'), data: data.map((d) => d.net) }], [data, t])
  const options = useMemo<ApexOptions>(() => {
    const names = data.map((d) => d.key)
    return mergeOptions(apexBase(lang), {
      chart: {
        type: 'bar',
        events: { dataPointSelection: (_e, _c, opts?: PointRef) => opts && onSelect(names[opts.dataPointIndex]!) },
      },
      plotOptions: { bar: { horizontal: true, distributed: true, barHeight: '68%', dataLabels: { position: 'top' } } },
      stroke: FILL_GAP_STROKE,
      colors: names.map((n) => selectionColor(scale.color(n), n, selected)),
      legend: { show: false },
      // Phones read the value from the tooltip: an in-bar label would not fit the shortest bars at 375px.
      dataLabels: {
        enabled: !isPhone,
        textAnchor: 'end',
        offsetX: -6,
        formatter: (v: number) => fmt.idrAxis(v),
        style: { colors: names.map((n) => scale.labelColor(n)) },
      },
      xaxis: { categories: names, tickAmount: isPhone ? 3 : 4, labels: { formatter: (v: string) => fmt.idrAxis(Number(v)) } },
      yaxis: { labels: { formatter: (v: number | string) => String(v), maxWidth: isPhone ? 96 : 140 } },
      grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      tooltip: {
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const d = data[dataPointIndex]!
          return `<div class="px-3 py-2"><div class="font-semibold">${escapeHtml(d.key)}</div><div>${escapeHtml(fmt.idr(d.net))} · ${escapeHtml(t('charts.shareOfTotal', { share: formatShare(d.share, lang) }))}</div></div>`
        },
      },
    })
  }, [data, fmt, isPhone, lang, onSelect, scale, selected, t])

  return (
    <ChartCard
      title={t('charts.region.title')}
      question={t('charts.region.question')}
      status={data.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={height}
      footer={t('charts.clickToFilter')}
    >
      <ApexChart type="bar" series={series} options={options} height={height} />
    </ChartCard>
  )
}
