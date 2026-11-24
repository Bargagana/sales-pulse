import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import { formatIdr, formatInt, formatMonth, formatPct } from '@core/index'
import type { Lang, Periods } from '@core/types'
import { StatCard, type Delta } from '@/components/layout'
import { apexBase, ink, mergeOptions } from '@/theme'
import { ApexChart } from './charts/ApexChart'
import { formatDay } from './model/format'
import type { Change, KpiView } from './model/views'

interface KpiRowProps {
  view: KpiView
  periods: Periods
  lang: Lang
  isPhone: boolean
}

/** PRD §6.6 "How much did we sell, and is it rising?": four KPIs, each with its MoM change and a daily sparkline. */
export function KpiRow({ view, periods, lang, isPhone }: KpiRowProps) {
  const { t } = useTranslation('dashboard')
  const { kpis, daily } = view

  const caption = periods.baseline
    ? periods.comparableDay
      ? t('kpi.vsPartial', { month: formatMonth(periods.baseline, lang), day: periods.comparableDay })
      : t('kpi.vs', { month: formatMonth(periods.baseline, lang) })
    : undefined

  const delta = (momPct: number | null, positiveIsGood = true): Delta => ({
    value: momPct,
    text: momPct === null ? undefined : formatPct(momPct, lang),
    caption,
    positiveIsGood,
  })

  const currentHint = (change: Change, format: (v: number) => string) =>
    periods.current ? t('kpi.inMonth', { value: format(change.current), month: formatMonth(periods.current, lang) }) : undefined

  // Stable per language, so each sparkline's memoised options survive unrelated re-renders.
  const { idr, int } = useMemo(() => ({ idr: (v: number) => formatIdr(v, lang), int: (v: number) => formatInt(v, lang) }), [lang])

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <StatCard
        primary
        label={t('kpi.netSales')}
        value={idr(kpis.netSales)}
        delta={delta(kpis.momPct)}
        hint={kpis.currentNet !== null && periods.current ? t('kpi.inMonth', { value: idr(kpis.currentNet), month: formatMonth(periods.current, lang) }) : undefined}
        sparkline={<Sparkline name={t('kpi.netSales')} dates={daily.dates} values={daily.net} format={idr} lang={lang} isPhone={isPhone} />}
      />
      <StatCard
        label={t('kpi.invoices')}
        value={int(kpis.invoices)}
        delta={delta(view.invoices.momPct)}
        hint={currentHint(view.invoices, int)}
        sparkline={<Sparkline name={t('kpi.invoices')} dates={daily.dates} values={daily.invoices} format={int} lang={lang} isPhone={isPhone} />}
      />
      <StatCard
        label={t('kpi.activeOutlets')}
        value={int(kpis.activeOutlets)}
        delta={delta(view.outlets.momPct)}
        hint={currentHint(view.outlets, int)}
        sparkline={<Sparkline name={t('kpi.activeOutlets')} dates={daily.dates} values={daily.outlets} format={int} lang={lang} isPhone={isPhone} />}
      />
      <StatCard
        label={t('kpi.returns')}
        value={idr(kpis.returnNet)}
        // More returns is bad: the arrow still follows the sign, the colour flips.
        delta={delta(view.returns.momPct, false)}
        hint={t('kpi.returnLines', { count: kpis.returnLines, formatted: int(kpis.returnLines) })}
        sparkline={<Sparkline name={t('kpi.returns')} dates={daily.dates} values={daily.returns} format={idr} lang={lang} isPhone={isPhone} />}
      />
    </div>
  )
}

interface SparklineProps {
  name: string
  dates: string[]
  values: number[]
  format: (v: number) => string
  lang: Lang
  isPhone: boolean
}

function Sparkline({ name, dates, values, format, lang, isPhone }: SparklineProps) {
  const series = useMemo(() => [{ name, data: values }], [name, values])
  const options = useMemo<ApexOptions>(
    () =>
      mergeOptions(apexBase(lang), {
        chart: { type: 'area', sparkline: { enabled: true }, animations: { enabled: false } },
        colors: [ink.secondary],
        stroke: { width: 1.5, curve: 'straight' },
        fill: { type: 'gradient', gradient: { opacityFrom: 0.2, opacityTo: 0 } },
        labels: dates,
        // A finger on a 48px strip hides the value it is reading, so phones get no sparkline tooltip.
        tooltip: {
          enabled: !isPhone,
          x: { formatter: (_v: number, opts?: { dataPointIndex: number }) => formatDay(dates[opts?.dataPointIndex ?? 0] ?? '', lang) },
          y: { formatter: format, title: { formatter: () => '' } },
          marker: { show: false },
        },
      }),
    [dates, format, isPhone, lang],
  )
  if (values.length < 2) return null
  return <ApexChart type="area" series={series} options={options} height={48} />
}
