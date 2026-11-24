import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, LoaderCircle, TriangleAlert } from 'lucide-react'
import { formatIdr, formatInt } from '@core/index'
import type { QualityReport } from '@core/types'
import { ErrorState } from '@/components/layout'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { messageForError } from '../errors'
import { BusyButton, FooterStart, InlineStatus, StepLayout, useLang, type Status } from '../parts'
import type { DataDraft, StepProps } from '../types'

/** Long lists (row numbers, mismatches) are cut here; the count above them stays exact. */
const LIST_LIMIT = 12

type Props = StepProps & {
  draft: DataDraft
  setDraft: (update: (draft: DataDraft) => DataDraft) => void
}

export function QualityStep({ onStateChange, back, onDone, draft, setDraft }: Props) {
  const { t } = useTranslation('onboarding')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const quality = draft.quality

  // After a reload the report from /data/apply is gone; the active dataset carries the same report.
  useEffect(() => {
    if (quality) return
    let live = true
    setLoadError(null)
    api.dataset().then(
      (dataset) => live && setDraft((d) => ({ ...d, quality: dataset.quality })),
      (error: unknown) => live && setLoadError(messageForError(t, 'quality', error)),
    )
    return () => {
      live = false
    }
    // `t` only feeds the error text; switching language must not refetch the dataset.
  }, [quality, attempt, setDraft])

  const confirm = async () => {
    setBusy(true)
    setStatus(null)
    try {
      onStateChange(await api.completeStep({ step: 'quality' }))
      onDone()
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'quality', error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('quality.title')}
      description={t('quality.description')}
      footer={
        <>
          <FooterStart>{back}</FooterStart>
          <BusyButton busy={busy} busyLabel={t('quality.confirming')} onClick={confirm} disabled={!quality}>
            {t('quality.confirm')}
          </BusyButton>
        </>
      }
    >
      {quality ? (
        <Report quality={quality} />
      ) : loadError ? (
        <ErrorState title={t('quality.loadErrorTitle')} message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
          {t('quality.loading')}
        </div>
      )}
      <InlineStatus status={status} />
    </StepLayout>
  )
}

function Report({ quality: q }: { quality: QualityReport }) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  const int = (n: number) => formatInt(n, lang)
  const fixedTotal = q.valuesFixed.reduce((sum, f) => sum + f.count, 0)
  const none = t('quality.none')
  const rowList = (rows: number[]) =>
    rows.length <= LIST_LIMIT
      ? rows.map(int).join(', ')
      : `${rows.slice(0, LIST_LIMIT).map(int).join(', ')} ${t('quality.more', { n: int(rows.length - LIST_LIMIT) })}`

  return (
    <>
      <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-3xl font-semibold tabular md:text-4xl">
          <span>{int(q.rowsRead)}</span>
          <ArrowRight className="size-6 self-center text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{t('quality.to')}</span>
          <span>{int(q.rowsClean)}</span>
        </p>
        <p className="text-sm text-muted-foreground">{t('quality.rowsCaption')}</p>
      </div>

      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        <Check title={t('quality.trimmed.title')} value={q.valuesTrimmed ? int(q.valuesTrimmed) : none} body={t('quality.trimmed.body')} />

        <Check
          title={t('quality.fixed.title')}
          value={fixedTotal ? int(fixedTotal) : none}
          body={t('quality.fixed.body')}
          details={
            q.valuesFixed.length > 0 && (
              <ul className="flex flex-col gap-1">
                {q.valuesFixed.map((f) => (
                  <li key={`${f.column}:${f.from}`} className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="text-muted-foreground">{t(`columns.${f.column}`)}:</span>
                    <span className="break-all">{f.from}</span>
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">{t('quality.to')}</span>
                    <span className="font-medium break-all">{f.to}</span>
                    <span className="text-muted-foreground tabular">
                      ({t('mapping.rows', { count: f.count, n: int(f.count) })})
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />

        <Check
          title={t('quality.duplicates.title')}
          value={q.duplicatesRemoved ? int(q.duplicatesRemoved) : none}
          body={t('quality.duplicates.body')}
          details={
            q.duplicateRowNumbers.length > 0 && (
              <p className="text-sm tabular">{t('quality.rowNumbers', { rows: rowList(q.duplicateRowNumbers) })}</p>
            )
          }
        />

        <Check
          title={t('quality.returns.title')}
          value={
            q.returnLines
              ? t('quality.returns.value', {
                  rows: t('mapping.rows', { count: q.returnLines, n: int(q.returnLines) }),
                  amount: formatIdr(q.returnNet, lang, { compact: false }),
                })
              : none
          }
          body={t('quality.returns.body')}
        />

        <Check
          title={t('quality.shared.title')}
          value={q.sharedOutletNames.length ? int(q.sharedOutletNames.length) : none}
          body={t('quality.shared.body')}
          details={
            q.sharedOutletNames.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {q.sharedOutletNames.map((s) => (
                  <li key={s.name}>{t('quality.shared.item', { name: s.name, ids: s.outletIds.join(', ') })}</li>
                ))}
              </ul>
            )
          }
        />

        <Check
          title={t('quality.variants.title')}
          value={q.outletIdsWithNameVariants.length ? int(q.outletIdsWithNameVariants.length) : none}
          body={t('quality.variants.body')}
          details={
            q.outletIdsWithNameVariants.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {q.outletIdsWithNameVariants.slice(0, LIST_LIMIT).map((v) => (
                  <li key={v.outletId}>{t('quality.variants.item', { id: v.outletId, names: v.names.join(' / ') })}</li>
                ))}
              </ul>
            )
          }
        />

        <Check
          title={t('quality.salesman.title')}
          value={q.missingSalesman ? int(q.missingSalesman) : none}
          body={t('quality.salesman.body')}
        />

        <Check
          title={t('quality.arithmetic.title')}
          value={q.arithmeticMismatches.length ? int(q.arithmeticMismatches.length) : none}
          body={t('quality.arithmetic.body')}
          warn={q.arithmeticMismatches.length > 0}
          details={
            q.arithmeticMismatches.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm tabular">
                {q.arithmeticMismatches.slice(0, LIST_LIMIT).map((m) => (
                  <li key={`${m.row}:${m.reason}`}>{t(`quality.arithmetic.${m.reason}`, { row: int(m.row) })}</li>
                ))}
                {q.arithmeticMismatches.length > LIST_LIMIT && (
                  <li className="text-muted-foreground">{t('quality.more', { n: int(q.arithmeticMismatches.length - LIST_LIMIT) })}</li>
                )}
              </ul>
            )
          }
        />

        <Check
          title={t('quality.unmapped.title')}
          value={q.unmapped.length ? int(q.unmapped.length) : none}
          body={t('quality.unmapped.body')}
          warn={q.unmapped.length > 0}
          details={
            q.unmapped.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {q.unmapped.map((u) => (
                  <li key={`${u.column}:${u.value}`}>
                    {t(`columns.${u.column}`)}: <span className="font-medium">{u.value}</span> (
                    {t('mapping.rows', { count: u.count, n: int(u.count) })})
                  </li>
                ))}
              </ul>
            )
          }
        />

        <Check
          title={t('quality.unparseable.title')}
          value={q.unparseable.length ? int(q.unparseable.length) : none}
          body={t('quality.unparseable.body')}
          warn={q.unparseable.length > 0}
          details={
            q.unparseable.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {q.unparseable.slice(0, LIST_LIMIT).map((u) => (
                  <li key={`${u.row}:${u.column}`} className="break-all">
                    {t('quality.unparseable.item', { row: int(u.row), column: t(`columns.${u.column}`), value: u.value })}
                  </li>
                ))}
                {q.unparseable.length > LIST_LIMIT && (
                  <li className="text-muted-foreground">{t('quality.more', { n: int(q.unparseable.length - LIST_LIMIT) })}</li>
                )}
              </ul>
            )
          }
        />

        <Check
          title={t('quality.missingColumns.title')}
          value={q.missingColumns.length ? q.missingColumns.map((c) => t(`columns.${c}`)).join(', ') : none}
          body={t('quality.missingColumns.body')}
        />
      </ul>
    </>
  )
}

/** One line of the report: what was checked, what was found, and what it means for the numbers. */
function Check({
  title,
  value,
  body,
  details,
  warn = false,
}: {
  title: string
  value: string
  body: string
  details?: ReactNode
  warn?: boolean
}) {
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={cn('flex items-center gap-1.5 text-sm font-medium', warn && 'text-negative')}>
          {warn && <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />}
          {title}
        </p>
        <p className="text-sm font-semibold tabular">{value}</p>
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
      {details}
    </li>
  )
}
