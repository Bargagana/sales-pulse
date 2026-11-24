import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatInt } from '@core/index'
import type { Dataset, Filters, Lang } from '@core/types'
import type { TelegramSendResponse } from '@core/api-types'
import { currentLang } from '@/i18n'
import { ApiRequestError, api, onDatasetChange } from '@/lib/api'

export type DatasetLoad = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; dataset: Dataset }

/**
 * Loads the active dataset once, then reloads it whenever the push API replaces it (SSE `dataset` event).
 * During a reload the previous dataset stays on screen, so charts do not flash back to skeletons.
 */
export function useDataset(): { load: DatasetLoad; retry: () => void } {
  const { t } = useTranslation('dashboard')
  const [load, setLoad] = useState<DatasetLoad>({ status: 'loading' })

  // Stable identity: `t` changes on a language switch, and that must not refetch the dataset or resubscribe.
  const fetchDataset = useStableCallback((reason: 'initial' | 'push') => {
    if (reason === 'initial') setLoad({ status: 'loading' })
    api.dataset().then(
      (dataset) => {
        setLoad({ status: 'ready', dataset })
        if (reason === 'push') toast.success(t('live.updated', { rows: formatInt(dataset.rows.length, currentLang()) }))
      },
      (error: unknown) => {
        if (reason === 'push') toast.error(t('live.failed'))
        else setLoad({ status: 'error', message: error instanceof ApiRequestError && error.code === 'no_dataset' ? t('errors.noDataset') : t('errors.dataset') })
      },
    )
  })

  useEffect(() => {
    fetchDataset('initial')
    return onDatasetChange(() => fetchDataset('push'))
  }, [fetchDataset])

  return { load, retry: () => fetchDataset('initial') }
}

/** A callback with a stable identity that always runs the latest closure, so memoised chart options can call it. */
export function useStableCallback<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}

/** Plain-language text for a failed send, keyed by the TestResult code (PRD §6.8). */
export function useTelegramSend(filters: Filters, lang: Lang) {
  const { t } = useTranslation('dashboard')
  const [sending, setSending] = useState(false)

  const describe = (res: Pick<TelegramSendResponse, 'code'>) => (res.code ? t(`telegram.errors.${res.code}`) : t('telegram.errors.unknown'))

  const send = async () => {
    setSending(true)
    try {
      const res = await api.sendTelegram({ filters, lang })
      if (res.ok) toast.success(t('telegram.sent'))
      else toast.error(t('telegram.failed'), { description: describe(res) })
    } catch (error) {
      const notConfigured = error instanceof ApiRequestError && error.code === 'telegram_not_configured'
      toast.error(t('telegram.failed'), { description: notConfigured ? t('telegram.errors.notConfigured') : t('telegram.errors.network') })
    } finally {
      setSending(false)
    }
  }

  return { send, sending }
}
