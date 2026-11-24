import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import { ChartCard, formatDateRange } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { apexBase, CATEGORICAL, ink, mergeOptions } from '@/theme'
import { useStableCallback } from '../hooks'
import { formatDay } from '../model/format'
import { ApexChart } from './ApexChart'
import { useEmptyState, useFormatters, type ChartBaseProps } from './common'

const DAY_MS = 86_400_000
const toTime = (isoDay: string) => Date.parse(`${isoDay}T00:00:00Z`)
const toIsoDay = (time: number) => new Date(Math.round(time / DAY_MS) * DAY_MS).toISOString().slice(0, 10)

interface DailyTrendProps extends ChartBaseProps {
  data: { date: string; net: number }[]
  onApplyRange: (from: string, to: string) => void
}

/**
 * "How is the daily trend?" Area chart; on desktop a brush strip below it zooms the main chart, and the zoomed
 * range can be applied as the date filter (the brush is this chart's cross-filter).
 */
export function DailyTrend({ data, onApplyRange, lang, isPhone, onClearFilters }: DailyTrendProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const [brushed, setBrushed] = useState<{ from: string; to: string } | null>(null)
  const height = isPhone ? 240 : 260
  const brushHeight = 90

  const series = useMemo(() => [{ name: t('charts.netSales'), data: data.map((d) => ({ x: toTime(d.date), y: d.net })) }], [data, t])
  const first = data[0]?.date
  const last = data.at(-1)?.date

  const onBrush = useStableCallback((min: number, max: number) => {
    const from = toIsoDay(min)
    const to = toIsoDay(max)
    setBrushed(from === first && to === last ? null : { from, to })
  })

  const main = useMemo<ApexOptions>(
    () =>
      mergeOptions(apexBase(lang), {
        chart: { id: 'daily-trend', type: 'area' },
        colors: [CATEGORICAL[0]],
        fill: { type: 'gradient', gradient: { opacityFrom: 0.25, opacityTo: 0, shadeIntensity: 0 } },
        xaxis: { type: 'datetime', labels: { datetimeUTC: true, format: 'd MMM' }, tickAmount: isPhone ? 4 : 8 },
        yaxis: { tickAmount: 4 },
        tooltip: {
          x: { formatter: (v: number) => formatDay(new Date(v).toISOString().slice(0, 10), lang) },
          y: { formatter: fmt.idr },
        },
      }),
    [fmt, isPhone, lang],
  )

  const brush = useMemo<ApexOptions>(
    () =>
      mergeOptions(apexBase(lang), {
        chart: {
          id: 'daily-trend-brush',
          type: 'area',
          brush: { enabled: true, target: 'daily-trend', autoScaleYaxis: true },
          selection: {
            enabled: true,
            xaxis: data.length > 0 ? { min: toTime(data[0]!.date), max: toTime(data.at(-1)!.date) } : undefined,
            fill: { color: CATEGORICAL[0], opacity: 0.1 },
            stroke: { color: CATEGORICAL[0], width: 1 },
          },
          events: { selection: (_chart, opts) => opts?.xaxis && onBrush(opts.xaxis.min, opts.xaxis.max) },
          animations: { enabled: false },
        },
        colors: [ink.secondary],
        fill: { type: 'gradient', gradient: { opacityFrom: 0.2, opacityTo: 0 } },
        xaxis: { type: 'datetime', labels: { datetimeUTC: true, format: 'd MMM' }, tickAmount: 6 },
        yaxis: { show: false, tickAmount: 2 },
        grid: { yaxis: { lines: { show: false } } },
        tooltip: { enabled: false },
      }),
    [data, lang, onBrush],
  )

  return (
    <ChartCard
      title={t('charts.daily.title')}
      question={t('charts.daily.question')}
      status={data.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={isPhone ? height : height + brushHeight}
      span={2}
      actions={
        brushed && (
          <Button variant="outline" size="sm" onClick={() => onApplyRange(brushed.from, brushed.to)}>
            {t('charts.daily.apply', { range: formatDateRange(brushed.from, brushed.to, lang) })}
          </Button>
        )
      }
      footer={isPhone ? undefined : t('charts.daily.footer')}
    >
      <ApexChart type="area" series={series} options={main} height={height} />
      {!isPhone && <ApexChart type="area" series={series} options={brush} height={brushHeight} />}
    </ChartCard>
  )
}
