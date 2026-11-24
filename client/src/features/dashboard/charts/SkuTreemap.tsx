import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApexOptions } from 'apexcharts'
import { ChartCard } from '@/components/layout'
import { apexBase, FILL_GAP_STROKE, mergeOptions, OTHER_COLOR, readableOn, type CategoricalScale } from '@/theme'
import { formatShare, selectionColor } from '../model/format'
import { foldTail, type SkuView } from '../model/views'
import { ApexChart } from './ApexChart'
import { escapeHtml, useEmptyState, useFormatters, type ChartBaseProps, type PointRef } from './common'

const MAX_TILES = 20

interface SkuTreemapProps extends ChartBaseProps {
  data: SkuView[]
  brandScale: CategoricalScale
  selected: string[] | undefined
  onSelect: (sku: string) => void
}

/**
 * "Which SKUs sell most?" Tile area = net sales; a tap filters by that SKU. Tiles take their brand's colour (not one
 * hue as in DESIGN.md) so the brand of each SKU reads at a glance and matches the donut.
 */
export function SkuTreemap({ data, brandScale, selected, onSelect, lang, isPhone, onClearFilters }: SkuTreemapProps) {
  const { t } = useTranslation('dashboard')
  const fmt = useFormatters(lang)
  const empty = useEmptyState(onClearFilters)
  const height = isPhone ? 360 : 340

  const tiles = useMemo(() => {
    const { top, other } = foldTail(data.filter((d) => d.net > 0), MAX_TILES)
    return other ? [...top, { ...other, key: t('charts.otherSkus'), brand: '' }] : top
  }, [data, t])

  const series = useMemo(() => [{ name: t('charts.netSales'), data: tiles.map((s) => ({ x: s.key, y: s.net })) }], [tiles, t])
  const options = useMemo<ApexOptions>(
    () =>
      mergeOptions(apexBase(lang), {
        chart: {
          type: 'treemap',
          events: {
            dataPointSelection: (_e, _c, opts?: PointRef) => {
              const tile = opts && tiles[opts.dataPointIndex]
              // The folded "Other" tile has no brand and is not a real SKU, so it is not selectable.
              if (tile?.brand) onSelect(tile.key)
            },
          },
        },
        // 'truncate' keeps a readable 12px SKU name cut to the tile ('scale' shrank small tiles to ~6px text); the
        // value is in the tooltip.
        plotOptions: { treemap: { distributed: true, enableShades: false, dataLabels: { format: 'truncate' } } },
        colors: tiles.map((s) => (s.brand ? selectionColor(brandScale.color(s.brand), s.key, selected) : OTHER_COLOR)),
        stroke: FILL_GAP_STROKE,
        legend: { show: false },
        dataLabels: {
          enabled: true,
          style: { fontSize: '12px', colors: tiles.map((s) => (s.brand ? brandScale.labelColor(s.brand) : readableOn(OTHER_COLOR))) },
        },
        tooltip: {
          custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
            const s = tiles[dataPointIndex]!
            const brand = s.brand ? `<div>${escapeHtml(s.brand)}</div>` : ''
            return `<div class="px-3 py-2"><div class="font-semibold">${escapeHtml(s.key)}</div>${brand}<div>${escapeHtml(fmt.idr(s.net))} · ${escapeHtml(t('charts.shareOfTotal', { share: formatShare(s.share, lang) }))}</div></div>`
          },
        },
      }),
    [brandScale, fmt, lang, onSelect, selected, t, tiles],
  )

  return (
    <ChartCard
      title={t('charts.sku.title')}
      question={t('charts.sku.question')}
      status={tiles.length === 0 ? 'empty' : 'ready'}
      empty={empty}
      height={height}
      footer={t('charts.sku.footer')}
    >
      <ApexChart type="treemap" series={series} options={options} height={height} />
    </ChartCard>
  )
}
