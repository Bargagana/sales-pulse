import { lazy, Suspense, useCallback, useMemo, useState, type Dispatch, type JSX, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, LoaderCircle, Send } from 'lucide-react'
import type { AppState } from '@core/api-types'
import { computePeriods, formatMonth } from '@core/index'
import type { Dataset, Filters, Lang, Periods } from '@core/types'
import { AppShell, ChartCard, DashboardGrid, EmptyState, ErrorState, Section, StatCard, useIsPhone, useLanguageSwitch } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { BrandDonut } from './charts/BrandDonut'
import { DailyTrend } from './charts/DailyTrend'
import { OutletChange } from './charts/OutletChange'
import { OutletTypeMix } from './charts/OutletTypeMix'
import { RegionBar } from './charts/RegionBar'
import { RegionBrandHeatmap } from './charts/RegionBrandHeatmap'
import { SkuTreemap } from './charts/SkuTreemap'
import { DataBanners } from './DataBanners'
import { FilterBar } from './filters/FilterBar'
import { useDataset, useTelegramSend } from './hooks'
import { branchTotals } from './charts/regionAreas'
import { KpiRow } from './KpiRow'
import { setDateRange, setDimension, toggleValue } from './model/filters'
import { buildViews, indexDataset } from './model/views'
import { SummaryCard } from './SummaryCard'
import { WeakestOutlets } from './WeakestOutlets'

const RegionMap = lazy(() => import('./charts/RegionMap'))

export function Dashboard({
  state,
  onStateChange,
  onOpenSettings,
}: {
  state: AppState
  onStateChange: (s: AppState) => void
  onOpenSettings: () => void
}): JSX.Element {
  const { t } = useTranslation('dashboard')
  const switchLang = useLanguageSwitch(state, onStateChange)
  const { load, retry } = useDataset()
  const [filters, setFilters] = useState<Filters>({})
  const telegram = useTelegramSend(filters, state.lang)
  // After a push the AppState summary is stale, so the badge reads the periods of the dataset on screen.
  const periods = useMemo(
    () => (load.status === 'ready' ? computePeriods(load.dataset.rows) : (state.dataset?.periods ?? null)),
    [load, state.dataset],
  )

  return (
    <AppShell
      lang={state.lang}
      onLangChange={switchLang}
      onOpenSettings={onOpenSettings}
      period={<ComparisonBadge periods={periods} lang={state.lang} />}
      actions={<SendButton onSend={telegram.send} sending={telegram.sending} disabled={load.status !== 'ready'} />}
    >
      {load.status === 'loading' && <DashboardSkeleton />}
      {load.status === 'error' && <ErrorState title={t('errors.datasetTitle')} message={load.message} onRetry={retry} className="min-h-[50dvh]" />}
      {load.status === 'ready' && (
        <DashboardBody
          dataset={load.dataset}
          filters={filters}
          setFilters={setFilters}
          lang={state.lang}
          onOpenSettings={onOpenSettings}
          onSend={telegram.send}
          sending={telegram.sending}
        />
      )}
    </AppShell>
  )
}

interface BodyProps {
  dataset: Dataset
  filters: Filters
  setFilters: Dispatch<SetStateAction<Filters>>
  lang: Lang
  onOpenSettings: () => void
  onSend: () => void
  sending: boolean
}

function DashboardBody({ dataset, filters, setFilters, lang, onOpenSettings, onSend, sending }: BodyProps) {
  const { t } = useTranslation('dashboard')
  const { t: tc } = useTranslation('common')
  const isPhone = useIsPhone()
  // Colour keys and picker options come from the unfiltered dataset, so a filter never repaints a region.
  const index = useMemo(() => indexDataset(dataset), [dataset])
  const views = useMemo(() => buildViews(dataset, index, filters), [dataset, index, filters])
  // Which provinces each region covers on the map depends on the whole dataset, never on filters.
  const allBranches = useMemo(() => branchTotals(dataset.rows), [dataset])

  // Stable handlers: every chart memoises its options on them.
  const clearFilters = useCallback(() => setFilters({}), [setFilters])
  const toggleRegion = useCallback((v: string) => setFilters((f) => toggleValue(f, 'regions', v)), [setFilters])
  const toggleBrand = useCallback((v: string) => setFilters((f) => toggleValue(f, 'brands', v)), [setFilters])
  const toggleOutletType = useCallback((v: string) => setFilters((f) => toggleValue(f, 'outletTypes', v)), [setFilters])
  const toggleSku = useCallback((v: string) => setFilters((f) => toggleValue(f, 'skus', v)), [setFilters])
  const toggleOutlet = useCallback((v: string) => setFilters((f) => toggleValue(f, 'outletIds', v)), [setFilters])
  const applyRange = useCallback((from: string, to: string) => setFilters((f) => setDateRange(f, from, to)), [setFilters])
  // A heatmap cell is one region and one brand: a click adds the pair, a click on an already selected pair removes it.
  const toggleCell = useCallback(
    (region: string, brand: string) =>
      setFilters((f) => {
        const pairSelected = !!f.regions?.includes(region) && !!f.brands?.includes(brand)
        const update = (values: string[] | undefined, value: string) =>
          pairSelected ? (values ?? []).filter((v) => v !== value) : [...new Set([...(values ?? []), value])]
        return setDimension(setDimension(f, 'regions', update(f.regions, region)), 'brands', update(f.brands, brand))
      }),
    [setFilters],
  )

  const base = { lang, isPhone, onClearFilters: clearFilters }
  const hasRows = views.rows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <DataBanners quality={dataset.quality} lang={lang} onOpenSettings={onOpenSettings} />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        options={index.options}
        bounds={{ from: index.periods.from, to: index.periods.to }}
        lang={lang}
        isPhone={isPhone}
        rowCount={views.rows.length}
      />

      <Section title={t('kpi.title')}>
        {hasRows ? (
          <KpiRow view={views.kpi} periods={views.periods} lang={lang} isPhone={isPhone} />
        ) : (
          <div className="rounded-lg border bg-card">
            <EmptyState
              title={tc('empty.filteredTitle')}
              description={tc('empty.filteredBody')}
              action={<Button variant="outline" onClick={clearFilters}>{t('filters.clearAll')}</Button>}
            />
          </div>
        )}
      </Section>

      <Section title={t('charts.title')} description={t('charts.description')}>
        <DashboardGrid className="md:grid-flow-row-dense">
          <Suspense fallback={<ChartCard title={t('charts.map.title')} question={t('charts.map.question')} status="loading" span={2} height={isPhone ? 300 : 400} />}>
            <RegionMap
              {...base}
              regions={views.regions}
              branches={views.branches}
              allBranches={allBranches}
              geo={dataset.branchGeo}
              regionScale={index.scales.region}
              selected={filters.regions}
              onSelect={toggleRegion}
            />
          </Suspense>
          <RegionBar {...base} data={views.regions} scale={index.scales.region} selected={filters.regions} onSelect={toggleRegion} />
          <DailyTrend {...base} data={views.daily} onApplyRange={applyRange} />
          <BrandDonut {...base} data={views.brands} scale={index.scales.brand} selected={filters.brands} onSelect={toggleBrand} />
          <SkuTreemap {...base} data={views.skus} brandScale={index.scales.brand} selected={filters.skus} onSelect={toggleSku} />
          <RegionBrandHeatmap {...base} data={views.regionBrand} onSelect={toggleCell} />
          <OutletChange {...base} data={views.outletChanges} hasBaseline={views.periods.baseline !== null} selected={filters.outletIds} onSelect={toggleOutlet} />
          <OutletTypeMix {...base} data={views.regionOutletType} scale={index.scales.outletType} selected={filters.outletTypes} onSelect={toggleOutletType} />
        </DashboardGrid>
      </Section>

      <WeakestOutlets rows={views.rows} periods={views.periods} lang={lang} isPhone={isPhone} />

      <SummaryCard filters={filters} lang={lang} onSend={onSend} sending={sending} />
    </div>
  )
}

/** Header badge: which month is compared with which (PRD §6.4), and the day window when the month is partial. */
function ComparisonBadge({ periods: p, lang }: { periods: Periods | null; lang: Lang }) {
  const { t } = useTranslation('dashboard')
  if (!p?.current) return null

  const text = p.baseline
    ? t('period.compare', { current: formatMonth(p.current, lang), baseline: formatMonth(p.baseline, lang) })
    : formatMonth(p.current, lang)

  return (
    <p className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground md:text-sm">
      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('period.label')}: </span>
      <span className="truncate text-foreground">{text}</span>
      {p.comparableDay !== null && p.baseline && <span className="shrink-0">{t('period.partial', { day: p.comparableDay })}</span>}
    </p>
  )
}

function SendButton({ onSend, sending, disabled }: { onSend: () => void; sending: boolean; disabled: boolean }) {
  const { t } = useTranslation('dashboard')
  return (
    <Button onClick={onSend} disabled={disabled || sending}>
      {sending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
      {/* The phone header also holds the language toggle and settings, so the label shortens there. */}
      <span className="max-sm:hidden">{sending ? t('telegram.sending') : t('telegram.send')}</span>
      <span className="sm:hidden">{sending ? t('telegram.sendingShort') : t('telegram.sendShort')}</span>
    </Button>
  )
}

function DashboardSkeleton() {
  const { t } = useTranslation('dashboard')
  return (
    <div className="flex flex-col gap-6" role="status" aria-label={t('loading')}>
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {(['netSales', 'invoices', 'activeOutlets', 'returns'] as const).map((key, i) => (
          <StatCard key={key} label={t(`kpi.${key}`)} value="" loading primary={i === 0} />
        ))}
      </div>
      <DashboardGrid>
        <ChartCard title={t('charts.map.title')} status="loading" span={2} height={400} />
        <ChartCard title={t('charts.region.title')} status="loading" />
      </DashboardGrid>
    </div>
  )
}
