import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, LoaderCircle, RefreshCw, Send } from 'lucide-react'
import { telegramMessage } from '@core/index'
import type { SummaryResponse } from '@core/api-types'
import type { Filters, Lang } from '@core/types'
import { ErrorState, Section } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

interface SummaryCardProps {
  filters: Filters
  lang: Lang
  onSend: () => void
  sending: boolean
}

type SummaryLoad =
  | { status: 'loading'; previous?: SummaryResponse }
  | { status: 'error' }
  | { status: 'ready'; data: SummaryResponse; requestKey: string }

const keyOf = (filters: Filters) => JSON.stringify(filters)

/**
 * PRD §6.5 summary with a Telegram-style preview. It is generated on open and on a language switch; a filter change
 * only marks it out of date, because each generation is a paid LLM call and filters change on every chart click.
 */
export function SummaryCard({ filters, lang, onSend, sending }: SummaryCardProps) {
  const { t } = useTranslation('dashboard')
  const [load, setLoad] = useState<SummaryLoad>({ status: 'loading' })
  const latestRequest = useRef(0)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const generate = () => {
    const requestFilters = filtersRef.current
    const request = ++latestRequest.current
    setLoad((prev) => ({ status: 'loading', previous: prev.status === 'ready' ? prev.data : undefined }))
    api.summary({ filters: requestFilters, lang }).then(
      (data) => request === latestRequest.current && setLoad({ status: 'ready', data, requestKey: keyOf(requestFilters) }),
      () => request === latestRequest.current && setLoad({ status: 'error' }),
    )
  }

  // Keyed on the language only: `generate` is a new function each render and reads the filters through a ref.
  useEffect(generate, [lang])

  const shown = load.status === 'ready' ? load.data : load.status === 'loading' ? load.previous : undefined
  const stale = load.status === 'ready' && load.requestKey !== keyOf(filters)
  const scope =
    filters.regions?.length === 1
      ? t('summary.scope.region', { region: filters.regions[0] })
      : (filters.regions?.length ?? 0) > 1
        ? t('summary.scope.combined', { count: filters.regions!.length })
        : t('summary.scope.national')

  const copy = async () => {
    if (!shown) return
    try {
      await navigator.clipboard.writeText(shown.summary)
      toast.success(t('summary.copied'))
    } catch {
      toast.error(t('summary.copyFailed'))
    }
  }

  return (
    <Section title={t('summary.title')} description={t('summary.description')}>
      <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:p-5">
        <div aria-live="polite" aria-busy={load.status === 'loading'} className="min-w-0">
          {load.status === 'error' ? (
            <ErrorState message={t('summary.error')} onRetry={generate} />
          ) : shown ? (
            <TelegramPreview html={telegramMessage(shown.summary, shown.facts, lang)} dimmed={load.status === 'loading'} />
          ) : (
            <div className="flex flex-col gap-2 rounded-lg bg-muted p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <span className="sr-only">{t('summary.generating')}</span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-muted-foreground">{t('summary.scope.label')}</dt>
              <dd className="font-medium">{scope}</dd>
            </div>
            {shown && (
              <div className="flex flex-wrap items-center gap-2">
                <dt className="text-muted-foreground">{t('summary.source.label')}</dt>
                <dd>
                  <Badge variant={shown.source === 'llm' ? 'outline' : 'secondary'} data-testid="summary-source">
                    {t(`summary.source.${shown.source}`)}
                  </Badge>
                </dd>
              </div>
            )}
          </dl>

          {shown && <p className="text-sm text-muted-foreground">{t(`summary.sourceNote.${shown.source}`)}</p>}
          {shown && shown.warnings.length > 0 && (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer py-2 font-medium text-foreground">{t('summary.warnings', { count: shown.warnings.length })}</summary>
              <ul className="list-disc pl-5">
                {shown.warnings.map((w) => (
                  <li key={w.code}>
                    {t(`summary.notice.${w.code}`)}
                    {/* detail is English diagnostic text from the server (e.g. the validator's last error). */}
                    {w.detail && (
                      <span lang="en" className="mt-1 block break-words text-xs">
                        {w.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {stale && (
            <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
              {t('summary.stale')}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={onSend} disabled={sending || !shown}>
              {sending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
              {sending ? t('telegram.sending') : t('telegram.send')}
            </Button>
            <Button variant={stale ? 'secondary' : 'outline'} onClick={generate} disabled={load.status === 'loading'}>
              <RefreshCw className={load.status === 'loading' ? 'animate-spin' : undefined} aria-hidden="true" />
              {load.status === 'loading' ? t('summary.generating') : t('summary.regenerate')}
            </Button>
            <Button variant="outline" onClick={copy} disabled={!shown}>
              <Copy aria-hidden="true" />
              {t('summary.copy')}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  )
}

const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * Renders core's Telegram HTML (only <b> and escaped text) as React nodes, so the preview shows exactly what the
 * chat will show without injecting HTML into the page.
 */
function TelegramPreview({ html, dimmed }: { html: string; dimmed: boolean }) {
  const { t } = useTranslation('dashboard')
  const lines = html.split('\n')

  return (
    <figure className="rounded-lg bg-muted p-3 md:p-4">
      <figcaption className="sr-only">{t('summary.previewLabel')}</figcaption>
      <div
        data-testid="telegram-preview"
        className={`relative max-w-prose rounded-lg rounded-bl-sm bg-card px-3 py-2 text-sm leading-relaxed shadow-xs transition-opacity ${dimmed ? 'opacity-60' : ''}`}
      >
        {lines.map((line, i) => (
          <Fragment key={i}>
            {line === '' ? <span className="block h-2" /> : <span className="block break-words">{renderBold(line)}</span>}
          </Fragment>
        ))}
      </div>
    </figure>
  )
}

function renderBold(line: string) {
  return line.split(/(<b>.*?<\/b>)/).map((part, i) =>
    part.startsWith('<b>') ? <strong key={i}>{unescape(part.slice(3, -4))}</strong> : <Fragment key={i}>{unescape(part)}</Fragment>,
  )
}
