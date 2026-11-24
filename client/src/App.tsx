import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState } from '@core/api-types'
import { AppShell, ErrorState, FullPageLoader } from '@/components/layout'
import i18n from '@/i18n'
import { ApiRequestError, api } from '@/lib/api'

// Separate chunks: a first run needs only the setup flow, and the dashboard brings ApexCharts with it.
const Dashboard = lazy(() => import('@/features/dashboard').then((m) => ({ default: m.Dashboard })))
const Onboarding = lazy(() => import('@/features/onboarding').then((m) => ({ default: m.Onboarding })))

function PageFallback() {
  return (
    <AppShell>
      <FullPageLoader />
    </AppShell>
  )
}

type Load = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; state: AppState }

export function App() {
  const { t } = useTranslation('common')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [settingsOpen, setSettingsOpen] = useState(false)

  // AppState.lang is the source of truth for the UI language; switch i18n before React renders the new state.
  // The module-level i18n instance keeps this callback stable: the hook's `i18n` changes identity on every
  // language switch, which would re-run the mount effect and refetch /api/state.
  const applyState = useCallback((next: AppState) => {
    if (i18n.language !== next.lang) void i18n.changeLanguage(next.lang)
    setLoad({ status: 'ready', state: next })
  }, [])

  const fetchState = useCallback(() => {
    setLoad({ status: 'loading' })
    api.state().then(applyState, (error: unknown) => setLoad({ status: 'error', error }))
  }, [applyState])

  useEffect(fetchState, [fetchState])

  if (load.status === 'loading') return <PageFallback />

  if (load.status === 'error') {
    // Usually the local server is not running (fetch failed, or the dev proxy answered with a bare 5xx):
    // say that plainly. A structured API error carries its own message.
    const apiError = load.error instanceof ApiRequestError && load.error.code !== 'http_error' ? load.error : null
    const message = apiError?.message ?? t('error.network')
    return (
      <AppShell>
        <ErrorState title={t('error.appStateTitle')} message={message} onRetry={fetchState} className="min-h-[60dvh]" />
      </AppShell>
    )
  }

  const { state } = load

  // Settings can re-run data steps, which briefly makes `onboarded` false; keep the settings flow mounted
  // instead of swapping to the initial flow mid-edit.
  if (settingsOpen) {
    return (
      <Suspense fallback={<PageFallback />}>
        {state.onboarded ? (
          <Dashboard state={state} onStateChange={applyState} onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <AppShell />
        )}
        {/* Its own boundary, so loading the settings chunk never blanks the dashboard behind it. */}
        <Suspense fallback={null}>
          <Onboarding mode="settings" state={state} onStateChange={applyState} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      </Suspense>
    )
  }

  if (!state.onboarded) {
    return (
      <AppShell>
        <Suspense fallback={<FullPageLoader />}>
          <Onboarding mode="initial" state={state} onStateChange={applyState} />
        </Suspense>
      </AppShell>
    )
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Dashboard state={state} onStateChange={applyState} onOpenSettings={() => setSettingsOpen(true)} />
    </Suspense>
  )
}
