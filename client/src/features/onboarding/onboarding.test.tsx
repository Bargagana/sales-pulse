// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, OnboardingStep, ProposeResponse } from '@core/api-types'
import type { DataProfile, Mapping } from '@core/types'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { Onboarding } from './index'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const fn = () => vi.fn()
  return {
    ...actual,
    api: {
      state: fn(),
      setLanguage: fn(),
      completeStep: fn(),
      configureLlm: fn(),
      uploadCsv: fn(),
      propose: fn(),
      apply: fn(),
      dataset: fn(),
      configureTelegram: fn(),
      pushToken: fn(),
      rotatePushToken: fn(),
      forgetCredentials: fn(),
    },
  }
})

const mocked = vi.mocked(api)
const t = (key: string) => i18n.t(`onboarding:${key}`)

function appState(done: OnboardingStep[], over: Partial<AppState> = {}): AppState {
  const completed = {
    language: done.includes('language'),
    llm: done.includes('llm'),
    data: done.includes('data'),
    mapping: done.includes('mapping'),
    quality: done.includes('quality'),
    telegram: done.includes('telegram'),
  }
  return { onboarded: false, completed, lang: 'id', llm: null, telegram: null, dataset: null, ...over }
}

const currentStepName = () => {
  const stepper = screen.getByRole('navigation', { name: t('stepper.label') })
  const current = stepper.querySelector('[aria-current="step"]')
  return current?.textContent ?? ''
}

beforeEach(async () => {
  vi.resetAllMocks()
  mocked.pushToken.mockResolvedValue({ token: 'sp_test_token_0123456789' })
  await i18n.changeLanguage('id')
})

afterEach(cleanup)

describe('initial mode is a gate', () => {
  it('has no close button and ignores Escape and outside clicks', () => {
    const onClose = vi.fn()
    render(<Onboarding mode="initial" state={appState([])} onStateChange={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByRole('button', { name: i18n.t('common:actions.close') })).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.pointerDown(document.body)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('settings mode closes with Escape', () => {
    const onClose = vi.fn()
    render(<Onboarding mode="settings" state={appState(['language'])} onStateChange={vi.fn()} onClose={onClose} />)
    expect(screen.getByRole('button', { name: i18n.t('common:actions.close') })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('a step must succeed before the next opens', () => {
  const fillLlm = () => {
    fireEvent.change(screen.getByLabelText(t('llm.apiKey')), { target: { value: 'sk-wrong' } })
    fireEvent.change(screen.getByLabelText(t('llm.model')), { target: { value: 'gpt-4.1-mini' } })
  }

  it('resumes at the first incomplete step', () => {
    render(<Onboarding mode="initial" state={appState(['language'])} onStateChange={vi.fn()} />)
    expect(currentStepName()).toContain(t('steps.llm'))
  })

  it('stays on the LLM step when the connection test fails, with a readable reason', async () => {
    mocked.configureLlm.mockResolvedValue({ ok: false, code: 'unauthorized', message: 'Invalid x-api-key' })
    const onStateChange = vi.fn()
    render(<Onboarding mode="initial" state={appState(['language'])} onStateChange={onStateChange} />)

    fillLlm()
    fireEvent.click(screen.getByRole('button', { name: t('llm.test') }))

    expect(await screen.findByText(t('errors.llm.unauthorized'))).toBeInTheDocument()
    // The provider's own text is never shown (it can echo the key).
    expect(screen.queryByText(/x-api-key/)).toBeNull()
    expect(currentStepName()).toContain(t('steps.llm'))
    expect(screen.queryByRole('button', { name: t('actions.continue') })).toBeNull()
    expect(mocked.state).not.toHaveBeenCalled()
    expect(onStateChange).not.toHaveBeenCalled()
  })

  it('does not call the server while required fields are empty', () => {
    render(<Onboarding mode="initial" state={appState(['language'])} onStateChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: t('llm.test') }))
    expect(screen.getByText(t('llm.errors.key'))).toBeInTheDocument()
    expect(mocked.configureLlm).not.toHaveBeenCalled()
  })

  it('moves on to the data step once the test succeeds', async () => {
    const next = appState(['language', 'llm'], {
      llm: { format: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', hasKey: true },
    })
    mocked.configureLlm.mockResolvedValue({ ok: true, message: 'ok' })
    mocked.state.mockResolvedValue(next)
    const onStateChange = vi.fn()
    render(<Onboarding mode="initial" state={appState(['language'])} onStateChange={onStateChange} />)

    fillLlm()
    fireEvent.click(screen.getByRole('button', { name: t('llm.test') }))

    await waitFor(() => expect(currentStepName()).toContain(t('steps.data')))
    expect(onStateChange).toHaveBeenCalledWith(next)
    expect(mocked.configureLlm).toHaveBeenCalledWith({
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-wrong',
    })
  })
})

describe('mapping review', () => {
  const profile: DataProfile = {
    headers: ['Tanggal', 'Region', 'Outlet', 'Brand', 'Nilai'],
    sampleRows: [['2026-09-01', 'Jabar', 'OUT1', 'Sukro', '1000']],
    rowCount: 1891,
    distinctValues: { Region: [{ value: 'Jabar', count: 4 }] },
  }
  const mapping: Mapping = {
    // "Nilai" was not recognised, so net_sales_idr (required) is unmapped.
    columnMap: { Tanggal: 'date', Region: 'region', Outlet: 'outlet_id', Brand: 'brand', Nilai: null },
    dateFormat: 'YYYY-MM-DD',
    numberFormat: 'plain',
    valueMap: { region: { Jabar: 'Jawa Barat' } },
    branchGeo: {},
    notes: [],
  }

  async function uploadAndPropose(proposal: ProposeResponse) {
    mocked.uploadCsv.mockResolvedValue({ uploadId: 'up_1', profile })
    mocked.state.mockResolvedValue(appState(['language', 'llm', 'data']))
    mocked.propose.mockResolvedValue(proposal)
    render(<Onboarding mode="initial" state={appState(['language', 'llm'])} onStateChange={vi.fn()} />)

    const file = new File(['date,region\n'], 'sales.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(t('data.choose')), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: t('data.upload') }))
    await screen.findByRole('button', { name: t('mapping.confirm') })
  }

  it('blocks Confirm while a required column is missing, and says which one', async () => {
    await uploadAndPropose({ mapping, source: 'heuristic', warnings: [], missingRequired: ['net_sales_idr'] })

    expect(screen.getByRole('button', { name: t('mapping.confirm') })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(t('columns.net_sales_idr'))
    expect(mocked.apply).not.toHaveBeenCalled()
  })

  it('shows each proposed value fix with its row count', async () => {
    await uploadAndPropose({ mapping, source: 'llm', warnings: [], missingRequired: ['net_sales_idr'] })
    expect(screen.getByDisplayValue('Jawa Barat')).toBeInTheDocument()
    expect(screen.getByText('4 baris')).toBeInTheDocument()
  })

  it('enables Confirm once every required column is mapped', async () => {
    const complete = { ...mapping, columnMap: { ...mapping.columnMap, Nilai: 'net_sales_idr' as const } }
    await uploadAndPropose({ mapping: complete, source: 'llm', warnings: [], missingRequired: [] })
    expect(screen.getByRole('button', { name: t('mapping.confirm') })).toBeEnabled()
  })
})
