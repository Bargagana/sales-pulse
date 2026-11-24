// Loaded lazily from the dashboard: Highcharts Maps and the topology are the heaviest part of the bundle, and the
// map is the only chart that needs them (PRD D2).
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Highcharts from 'highcharts/highmaps'
// Keyboard navigation and screen-reader descriptions for the map; attaches to the highmaps instance imported above.
import 'highcharts/modules/accessibility'
import { HighchartsReact } from 'highcharts-react-official'
import topology from '@highcharts/map-collection/countries/id/id-all.topo.json'
import type { Breakdown, GeoPoint } from '@core/types'
import { ChartCard } from '@/components/layout'
import { applyHighchartsLang, highchartsTheme, ink, mergeOptions, type CategoricalScale } from '@/theme'
import { formatShare, selectionColor } from '../model/format'
import type { BranchView } from '../model/views'
import { ChartLegend, type LegendItem } from './ChartLegend'
import { escapeHtml, useEmptyState, useFormatters, type ChartBaseProps } from './common'
import { assignRegions, decodeProvinces, type BranchTotal, type TopoLike } from './regionAreas'

// Decoded once per page load; the topology never changes.
const SHAPES = decodeProvinces(topology as unknown as TopoLike)

export interface RegionMapProps extends ChartBaseProps {
  /** Net per region in the current filters (the region filter itself excluded, like the region bar). */
  regions: Breakdown[]
  /** Branches in the current filters, for the tooltip. */
  branches: BranchView[]
  /** Every branch in the whole dataset with its region: decides which provinces a region covers, so filters never move borders. */
  allBranches: BranchTotal[]
  geo: Record<string, GeoPoint>
  regionScale: CategoricalScale
  selected: string[] | undefined
  onSelect: (region: string) => void
}

/**
 * "Where are sales across Indonesia?" Each sales region is drawn as the provinces it covers, in the region's colour
 * (the same colour as in the region bar). Rules for regions that are not provinces are in regionAreas.ts.
 */
export default function RegionMap({ regions, branches, allBranches, geo, regionScale, selected, onSelect, lang, isPhone, onClearFilters }: RegionMapProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const height = isPhone ? 300 : 400

  // Province ownership depends only on the dataset, not on filters.
  const areas = useMemo(
    () => assignRegions(SHAPES, [...new Set(allBranches.map((b) => b.region))], allBranches, geo),
    [allBranches, geo],
  )

  // Java's regions are too small for every map label to fit, so the legend carries each region's name and total.
  const legend = useMemo<LegendItem[]>(
    () =>
      [...regions]
        .filter((r) => r.net > 0 && !areas.unplaced.includes(r.key))
        .sort((a, b) => b.net - a.net)
        .map((r) => ({ key: r.key, label: r.key, color: selectionColor(regionScale.color(r.key), r.key, selected), detail: fmt.idrCompact(r.net) })),
    [areas.unplaced, fmt, regionScale, regions, selected],
  )

  applyHighchartsLang(Highcharts, lang)

  const options = useMemo<Highcharts.Options>(() => {
    const netOf = new Map(regions.map((r) => [r.key, r]))
    const branchesOf = new Map<string, BranchView[]>()
    for (const b of branches) if (b.net !== 0) branchesOf.set(b.region, [...(branchesOf.get(b.region) ?? []), b])

    const tooltipFor = (region: string) => {
      const r = netOf.get(region)
      if (!r) return `<b>${escapeHtml(region)}</b><br/>${escapeHtml(t('charts.map.noSales'))}`
      const list = (branchesOf.get(region) ?? [])
        .sort((a, b) => b.net - a.net)
        .slice(0, 8)
        .map((b) => `${escapeHtml(b.key)}: ${escapeHtml(fmt.idr(b.net))}`)
        .join('<br/>')
      return (
        `<b>${escapeHtml(region)}</b><br/>${escapeHtml(fmt.idr(r.net))} · ${escapeHtml(t('charts.shareOfTotal', { share: formatShare(r.share, lang) }))}` +
        (list ? `<br/><br/>${escapeHtml(t('charts.map.branches'))}<br/>${list}` : '')
      )
    }

    const provinceData = Object.entries(areas.provinceRegion)
      .filter(([, region]) => (netOf.get(region)?.net ?? 0) > 0)
      .map(([key, region]) => ({
        'hc-key': key,
        region,
        value: netOf.get(region)!.net,
        color: selectionColor(regionScale.color(region), region, selected),
      }))

    const labels = Object.entries(areas.labelAt)
      .filter(([region]) => (netOf.get(region)?.net ?? 0) > 0)
      .map(([region, p]) => ({
        name: region,
        amount: fmt.idrCompact(netOf.get(region)!.net),
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      }))

    const b = areas.bounds
    return mergeOptions(highchartsTheme(), {
      chart: { map: topology as unknown as Highcharts.TopoJSON, height },
      // Framed on the provinces that carry a region, so a filter never re-zooms the map.
      mapView: b
        ? { fitToGeometry: { type: 'MultiPoint', coordinates: [[b[0], b[1]], [b[2], b[3]]] }, padding: isPhone ? 8 : 24 }
        : undefined,
      // On a phone a drag must scroll the page, so the map is fixed there; zoom buttons only from md up.
      mapNavigation: { enabled: !isPhone },
      legend: { enabled: false },
      tooltip: { headerFormat: '', useHTML: false, followTouchMove: false },
      series: [
        {
          type: 'map',
          name: t('charts.netSales'),
          joinBy: 'hc-key',
          data: provinceData,
          // The theme keeps the basemap inert; this series carries the data, so it takes the mouse.
          enableMouseTracking: true,
          cursor: 'pointer',
          borderColor: ink.surface,
          borderWidth: 0.8,
          states: { hover: { enabled: true, brightness: -0.08, borderColor: ink.primary, borderWidth: 1 }, inactive: { opacity: 1 } },
          point: {
            events: {
              click(this: Highcharts.Point) {
                const region = (this as unknown as { region?: string }).region
                if (region) onSelect(region)
              },
            },
          },
          tooltip: {
            pointFormatter(this: Highcharts.Point) {
              const region = (this as unknown as { region?: string }).region
              return region ? tooltipFor(region) : ''
            },
          },
        },
        {
          type: 'mappoint',
          name: 'labels',
          data: labels,
          enableMouseTracking: false,
          marker: { enabled: false },
          showInLegend: false,
          dataLabels: {
            enabled: true,
            // Labels that would overlap are hidden by Highcharts; the tooltip still has every number.
            allowOverlap: false,
            format: isPhone ? '{point.name}' : '{point.name}<br/>{point.amount}',
            align: 'center',
            verticalAlign: 'middle',
            y: 0,
            style: {
              color: ink.primary,
              fontSize: isPhone ? '10px' : '11px',
              fontWeight: '600',
              textOutline: `2px ${ink.surface}`,
              textAlign: 'center',
              // A label sits on its region; a tap on it must reach the area underneath.
              pointerEvents: 'none',
            },
          },
        },
      ],
    })
  }, [areas, branches, fmt, height, isPhone, lang, onSelect, regionScale, regions, selected, t])

  return (
    <ChartCard
      title={t('charts.map.title')}
      question={t('charts.map.question')}
      status={regions.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={height}
      span={2}
      footer={t('charts.map.footer')}
    >
      <HighchartsReact key={lang} highcharts={Highcharts} constructorType="mapChart" options={options} />
      <ChartLegend label={t('charts.legend', { chart: t('charts.map.title') })} items={legend} selected={selected} onSelect={onSelect} className="mt-2" />
      {areas.unplaced.length > 0 && (
        <div className="mt-2 text-sm">
          <h4 className="font-medium">{t('charts.map.notOnMap')}</h4>
          <p className="text-muted-foreground">{areas.unplaced.join(', ')}</p>
        </div>
      )}
    </ChartCard>
  )
}
