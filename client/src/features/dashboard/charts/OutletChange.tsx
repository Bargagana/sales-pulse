import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import { formatPct } from '@core/index'
import type { WeakOutlet } from '@core/types'
import { ChartCard } from '@/components/layout'
import { apexBase, changeColor, FILL_GAP_STROKE, mergeOptions } from '@/theme'
import { ApexChart } from './ApexChart'
import { selectionColor } from '../model/format'
import { escapeHtml, useEmptyState, useFormatters, type ChartBaseProps, type PointRef } from './common'

interface OutletChangeProps extends ChartBaseProps {
  data: WeakOutlet[]
  hasBaseline: boolean
  selected: string[] | undefined
  onSelect: (outletId: string) => void
}

/** "Which outlets fell the most?" Diverging bars of the Rp change baseline -> current, red down, blue up. */
export function OutletChange({ data, hasBaseline, selected, onSelect, lang, isPhone, onClearFilters }: OutletChangeProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const height = Math.max(240, data.length * 38 + 50)

  const series = useMemo(() => [{ name: t('charts.change'), data: data.map((o) => o.change) }], [data, t])
  const options = useMemo<ApexOptions>(() => {
    const signed = (v: number) => (v > 0 ? `+${fmt.idrAxis(v)}` : fmt.idrAxis(v))
    return mergeOptions(apexBase(lang), {
      chart: {
        type: 'bar',
        events: {
          dataPointSelection: (_e, _c, opts?: PointRef) => {
            const outlet = opts && data[opts.dataPointIndex]
            if (outlet) onSelect(outlet.outletId)
          },
        },
      },
      plotOptions: { bar: { horizontal: true, distributed: true, barHeight: '64%', borderRadiusApplication: 'end', dataLabels: { position: 'top' } } },
      stroke: FILL_GAP_STROKE,
      colors: data.map((o) => selectionColor(changeColor(o.change), o.outletId, selected)),
      legend: { show: false },
      // No value labels: Apex anchors them inside the bar end, where they collide with short negative bars.
      // The value axis and the tooltip carry the amounts.
      dataLabels: { enabled: false },
      // Two outlets can share a name (PRD AC2: OUT1045 and OUT1041), so the ID is part of every label. On a phone
      // the ID leads, so it survives when the label is cut short.
      xaxis: {
        categories: data.map((o) => (isPhone ? `${o.outletId} ${o.name}` : `${o.name || o.outletId} · ${o.outletId}`)),
        tickAmount: isPhone ? 2 : 4,
        labels: { formatter: (v: string) => fmt.idrAxis(Number(v)) },
      },
      yaxis: { labels: { formatter: (v: number | string) => String(v), maxWidth: isPhone ? 120 : 220 } },
      grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      tooltip: {
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const o = data[dataPointIndex]!
          const lines = [
            `${escapeHtml(o.outletId)} · ${escapeHtml(o.outletType)} · ${escapeHtml(o.branch)}`,
            `${escapeHtml(fmt.idr(o.baseline))} → ${escapeHtml(fmt.idr(o.current))}`,
            `${escapeHtml(signed(o.change))} (${escapeHtml(formatPct(o.momPct, lang))})`,
          ]
          return `<div class="px-3 py-2"><div class="font-semibold">${escapeHtml(o.name)}</div>${lines.map((l) => `<div>${l}</div>`).join('')}</div>`
        },
      },
    })
  }, [data, fmt, isPhone, lang, onSelect, selected])

  return (
    <ChartCard
      title={t('charts.outletChange.title')}
      question={t('charts.outletChange.question')}
      status={data.length === 0 ? 'empty' : 'ready'}
      empty={hasBaseline ? empty : { title: t('charts.needsTwoMonths.title'), description: t('charts.needsTwoMonths.body') }}
      height={height}
      span={2}
      footer={t('charts.outletChange.footer')}
    >
      <ApexChart type="bar" series={series} options={options} height={height} />
    </ChartCard>
  )
}
