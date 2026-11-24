// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ApexOptions } from 'apexcharts'
import { applyFilters, buildFacts, computeKpis, computePeriods, fallbackTemplate, formatIdr, renderSummary } from '@core/index'
import type { SummaryResponse } from '@core/api-types'
import type { Dataset } from '@core/types'
import '@/i18n'
import { api } from '@/lib/api'
import { categoricalScale } from '@/theme'
import { BrandDonut } from './charts/BrandDonut'
import { Dashboard } from './index'
import { SummaryCard } from './SummaryCard'
import { onboardedState, sampleDataset } from './test-fixtures'
import { WeakestOutlets } from './WeakestOutlets'

vi.mock('@/lib/api', () => ({
  api: { dataset: vi.fn(), summary: vi.fn(), sendTelegram: vi.fn(), setLanguage: vi.fn() },
  onDatasetChange: () => () => {},
  ApiRequestError: class ApiRequestError extends Error {},
}))

// Charts are replaced by one button per category that fires the chart's own click handler, so the tests drive
// the real cross-filter wiring without an SVG renderer.
const apexOptions = vi.hoisted(() => new Map<string, ApexOptions>())
vi.mock('./charts/ApexChart', () => ({
  ApexChart: ({ type, options }: { type: string; options: ApexOptions }) => {
    apexOptions.set(type, options)
    const labels = ((options.xaxis?.categories as string[] | undefined) ?? options.labels ?? []).map(String)
    return (
      <div data-testid={`apex-${type}`}>
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => options.chart?.events?.dataPointSelection?.(e.nativeEvent, undefined, { seriesIndex: 0, dataPointIndex: i } as never)}
          >
            {label}
          </button>
        ))}
      </div>
    )
  },
}))
vi.mock('./charts/RegionMap', () => ({ default: () => <div data-testid="map" /> }))

let dataset: Dataset

beforeAll(() => {
  dataset = sampleDataset()
})
beforeEach(() => {
  vi.mocked(api.dataset).mockResolvedValue(dataset)
  vi.mocked(api.summary).mockImplementation(async ({ filters, lang }) => summaryResponse(filters.regions?.[0], lang, 'fallback'))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function summaryResponse(region: string | undefined, lang: 'id' | 'en', source: SummaryResponse['source']): SummaryResponse {
  const facts = buildFacts(applyFilters(dataset.rows, region ? { regions: [region] } : {}), { region })
  const template = fallbackTemplate(facts, lang)
  return { summary: renderSummary(template, facts, lang), template, source, facts, warnings: [] }
}

const netKpi = () => screen.getByText('Penjualan bersih', { selector: 'p' }).parentElement!.querySelector('p.text-3xl')!.textContent

describe('Dashboard', () => {
  it('shows the golden total, and a click on a region bar filters every KPI to that region', async () => {
    render(<Dashboard state={onboardedState(dataset)} onStateChange={vi.fn()} onOpenSettings={vi.fn()} />)

    await screen.findByText('Penjualan per region')
    expect(netKpi()).toBe('Rp 1,73 miliar')

    const regionCard = screen.getByRole('region', { name: 'Penjualan per region' })
    fireEvent.click(within(regionCard).getByRole('button', { name: 'Kalimantan' }))

    const expected = computeKpis(applyFilters(dataset.rows, { regions: ['Kalimantan'] }))
    expect(expected.netSales).toBe(144_240_400) // PRD AC2 region table
    expect(netKpi()).toBe(formatIdr(expected.netSales, 'id'))
    expect(screen.getByText('Faktur').parentElement!.textContent).toContain(String(expected.invoices))
    expect(within(screen.getByRole('list', { name: 'Filter aktif' })).getByText('Region: Kalimantan')).toBeTruthy()

    // A second click on the same bar releases the filter.
    fireEvent.click(within(regionCard).getByRole('button', { name: 'Kalimantan' }))
    expect(netKpi()).toBe('Rp 1,73 miliar')
  })

  it('removes a filter from its chip and keeps the brand donut cross-filter', async () => {
    render(<Dashboard state={onboardedState(dataset)} onStateChange={vi.fn()} onOpenSettings={vi.fn()} />)
    await screen.findByText('Pangsa brand')

    fireEvent.click(within(screen.getByRole('region', { name: 'Pangsa brand' })).getByRole('button', { name: 'Tos Tos' }))
    expect(netKpi()).toBe(formatIdr(285_909_300, 'id'))

    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter Brand: Tos Tos' }))
    expect(netKpi()).toBe('Rp 1,73 miliar')
  })

  it('shows a retryable error when the dataset cannot be loaded', async () => {
    vi.mocked(api.dataset).mockRejectedValueOnce(new Error('down'))
    render(<Dashboard state={onboardedState(dataset)} onStateChange={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await screen.findByText('Penjualan per region')
  })
})

describe('BrandDonut legend', () => {
  const payload = '<img src=x onerror="window.__xss=1">'
  const data = [
    { key: 'Sukro', net: 600, share: 0.6 },
    { key: payload, net: 400, share: 0.4 },
  ]
  const renderDonut = (onSelect = vi.fn()) => {
    render(<BrandDonut data={data} scale={categoricalScale(data.map((d) => d.key))} selected={undefined} onSelect={onSelect} lang="en" isPhone onClearFilters={vi.fn()} />)
    return within(screen.getByRole('list', { name: 'Legenda: Pangsa brand' }))
  }

  it('shows a brand name from the data as text, never as markup', () => {
    const legend = renderDonut()
    expect(legend.getByText(payload)).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    // ApexCharts writes a formatted legend label with innerHTML, so its own legend must stay off.
    expect(apexOptions.get('donut')?.legend?.show).toBe(false)
  })

  it('filters by brand on a tap, like a tap on the slice', () => {
    const onSelect = vi.fn()
    fireEvent.click(renderDonut(onSelect).getByRole('button', { name: /^Sukro/ }))
    expect(onSelect).toHaveBeenCalledWith('Sukro')
  })
})

describe('WeakestOutlets', () => {
  it('lists the PRD §8 top 5 in order, with the new outlet noted as excluded', () => {
    render(<WeakestOutlets rows={dataset.rows} periods={computePeriods(dataset.rows)} lang="id" isPhone={false} />)

    const rows = screen.getAllByTestId('weak-row')
    expect(rows.map((r) => r.textContent!.match(/OUT\d+/)![0])).toEqual(['OUT1022', 'OUT1045', 'OUT1043', 'OUT1041', 'OUT1048'])
    expect(rows[0]!.textContent).toContain('Toko Bintang')
    expect(rows[0]!.textContent).toContain('-63,2%')
    expect(rows[0]!.textContent).toContain('Rp 8.764.300')
    expect(rows[0]!.textContent).toContain('Rp 3.223.100')
    expect(rows[1]!.textContent).toContain('-54,9%')
    expect(screen.getByText(/OUT1047/).textContent).toContain('tidak diurutkan')
  })

  it('switches to "lowest vs peers" and shows cards on a phone', () => {
    render(<WeakestOutlets rows={dataset.rows} periods={computePeriods(dataset.rows)} lang="id" isPhone />)
    expect(screen.getByRole('list').tagName).toBe('OL')
    fireEvent.click(screen.getByRole('radio', { name: 'Terendah vs rekan' }))
    expect(screen.getAllByTestId('weak-row')).toHaveLength(5)
    expect(screen.queryByText(/OUT1047.*tidak diurutkan/)).toBeNull()
  })
})

describe('SummaryCard', () => {
  it.each<[SummaryResponse['source'], string]>([
    ['llm', 'AI'],
    ['fallback', 'Template standar'],
  ])('renders the %s source badge and the Telegram preview', async (source, badge) => {
    vi.mocked(api.summary).mockResolvedValueOnce(summaryResponse(undefined, 'id', source))
    render(<SummaryCard filters={{}} lang="id" onSend={vi.fn()} sending={false} />)

    expect((await screen.findByTestId('summary-source')).textContent).toBe(badge)
    const preview = screen.getByTestId('telegram-preview').textContent!
    expect(preview).toContain('Rp 1,73 miliar')
    expect(preview).toContain('Toko Bintang')
    expect(api.summary).toHaveBeenCalledWith({ filters: {}, lang: 'id' })
  })

  it('marks the summary out of date when filters change, and regenerates on request', async () => {
    const { rerender } = render(<SummaryCard filters={{}} lang="id" onSend={vi.fn()} sending={false} />)
    await screen.findByTestId('summary-source')

    rerender(<SummaryCard filters={{ regions: ['Sumatera'] }} lang="id" onSend={vi.fn()} sending={false} />)
    expect(screen.getByText(/Filter sudah berubah/)).toBeTruthy()
    expect(screen.getByText('Region Sumatera')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Buat ulang' }))
    await waitFor(() => expect(screen.queryByText(/Filter sudah berubah/)).toBeNull())
    expect(api.summary).toHaveBeenLastCalledWith({ filters: { regions: ['Sumatera'] }, lang: 'id' })
  })
})
