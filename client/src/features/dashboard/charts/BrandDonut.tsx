import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import type { Breakdown } from '@core/types'
import { ChartCard } from '@/components/layout'
import { apexBase, FILL_GAP_STROKE, ink, mergeOptions, type CategoricalScale } from '@/theme'
import { formatShare, selectionColor } from '../model/format'
import { foldTail } from '../model/views'
import { ApexChart } from './ApexChart'
import { ChartLegend } from './ChartLegend'
import { useEmptyState, useFormatters, type ChartBaseProps, type PointRef } from './common'

const MAX_SLICES = 8

interface BrandDonutProps extends ChartBaseProps {
  data: Breakdown[]
  scale: CategoricalScale
  selected: string[] | undefined
  onSelect: (brand: string) => void
}

/** "What share does each brand have?" Donut with the total in the centre and each share in the legend below it. */
export function BrandDonut({ data, scale, selected, onSelect, lang, isPhone, onClearFilters }: BrandDonutProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const height = isPhone ? 260 : 280

  const slices = useMemo(() => {
    const { top, other } = foldTail(data, MAX_SLICES)
    // A brand whose returns outweigh its sales is net negative; a donut cannot draw that, the heatmap still shows it.
    const positive = top.filter((d) => d.net > 0)
    return other && other.net > 0 ? [...positive, { ...other, key: t('charts.other') }] : positive
  }, [data, t])

  const series = useMemo(() => slices.map((s) => s.net), [slices])
  const options = useMemo<ApexOptions>(() => {
    const names = slices.map((s) => s.key)
    const otherLabel = t('charts.other')
    const total = slices.reduce((sum, s) => sum + s.net, 0)
    return mergeOptions(apexBase(lang), {
      chart: {
        type: 'donut',
        events: {
          dataPointSelection: (_e, _c, opts?: PointRef) => {
            const name = opts && names[opts.dataPointIndex]
            if (name && name !== otherLabel) onSelect(name)
          },
        },
      },
      labels: names,
      colors: names.map((n) => selectionColor(scale.color(n), n, selected)),
      stroke: FILL_GAP_STROKE,
      legend: { show: false },
      plotOptions: {
        pie: {
          donut: {
            size: '64%',
            labels: {
              show: true,
              name: { show: true, fontSize: '12px', color: ink.secondary, offsetY: -4 },
              value: { show: true, fontSize: '18px', fontWeight: 600, color: ink.primary, offsetY: 4, formatter: (v: string) => fmt.idrCompact(Number(v)) },
              total: { show: true, showAlways: true, label: t('charts.total'), fontSize: '12px', color: ink.secondary, formatter: () => fmt.idrCompact(total) },
            },
          },
        },
      },
      tooltip: { y: { formatter: (v: number) => `${fmt.idr(v)} (${formatShare(total ? v / total : 0, lang)})` } },
    })
  }, [fmt, lang, onSelect, scale, selected, slices, t])

  // The legend doubles as the value table: name and share are readable without hovering.
  const legend = useMemo(() => {
    const otherLabel = t('charts.other')
    return slices.map((s) => ({
      key: s.key,
      label: s.key,
      detail: formatShare(s.share, lang),
      color: selectionColor(scale.color(s.key), s.key, selected),
      selectable: s.key !== otherLabel,
    }))
  }, [lang, scale, selected, slices, t])

  return (
    <ChartCard
      title={t('charts.brand.title')}
      question={t('charts.brand.question')}
      status={slices.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={height}
      footer={t('charts.clickToFilter')}
    >
      <ApexChart type="donut" series={series} options={options} height={height} />
      <ChartLegend label={t('charts.legend', { chart: t('charts.brand.title') })} items={legend} selected={selected} onSelect={onSelect} className="mt-2" />
    </ChartCard>
  )
}
