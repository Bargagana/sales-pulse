import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, LoaderCircle, Plus, X } from 'lucide-react'
import { formatInt, missingRequiredColumns } from '@core/index'
import {
  CANONICAL_COLUMNS,
  MAPPABLE_COLUMNS,
  type CanonicalColumn,
  type DataProfile,
  type DateFormat,
  type MappableColumn,
  type Mapping,
  type NumberFormat,
} from '@core/types'
import type { Notice, ProposeResponse } from '@core/api-types'
import { ErrorState } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LOCALE_TAG } from '@/i18n'
import { api } from '@/lib/api'
import { messageForError } from '../errors'
import {
  distinctFor,
  duplicateTargets,
  invalidFixes,
  isRequired,
  removeBranchGeo,
  removeValueFix,
  setColumn,
  setValueFix,
  valueFixes,
  type ValueFix,
} from '../flow'
import { BusyButton, Field, FooterStart, InlineStatus, StepLayout, useFieldId, useLang, type Status } from '../parts'
import type { DataDraft, StepProps } from '../types'

/** Radix Select items cannot have an empty value, so "ignore this column" needs a sentinel. */
const IGNORE = '__ignore__'
/** i18n key per date format (the formats themselves contain characters i18next treats as key separators). */
const DATE_FORMAT_KEYS: Record<DateFormat, string> = {
  'YYYY-MM-DD': 'iso',
  'DD/MM/YYYY': 'dmySlash',
  'DD-MM-YYYY': 'dmyDash',
  'MM/DD/YYYY': 'mdySlash',
}
const DATE_FORMATS = Object.keys(DATE_FORMAT_KEYS) as DateFormat[]
const NUMBER_FORMATS: NumberFormat[] = ['plain', 'id', 'en']

type Props = StepProps & {
  draft: DataDraft
  setDraft: (update: (draft: DataDraft) => DataDraft) => void
}

export function MappingStep({ onStateChange, back, onDone, draft, setDraft }: Props) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  const { upload, proposal, mapping } = draft
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  // StrictMode runs effects twice in dev; one LLM call per upload is enough.
  const requested = useRef<string | null>(null)

  useEffect(() => {
    if (!upload || proposal || requested.current === upload.uploadId) return
    requested.current = upload.uploadId
    setLoadError(null)
    api.propose(upload.uploadId).then(
      (res) =>
        setDraft((d) => (d.upload?.uploadId === upload.uploadId ? { ...d, proposal: res, mapping: res.mapping } : d)),
      (error: unknown) => {
        requested.current = null
        setLoadError(messageForError(t, 'mapping', error))
      },
    )
    // `t` is left out on purpose: it is only read for the error text, and a language switch must not call the LLM again.
  }, [upload, proposal, attempt, setDraft])

  const update = (next: Mapping) => {
    setStatus(null)
    setDraft((d) => ({ ...d, mapping: next }))
  }

  const footerBack = <FooterStart>{back}</FooterStart>

  if (!upload || !proposal || !mapping) {
    return (
      <StepLayout title={t('mapping.title')} footer={footerBack}>
        {loadError ? (
          <ErrorState
            title={t('mapping.loadErrorTitle')}
            message={loadError}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm font-medium">{t('mapping.loading')}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t('mapping.loadingDetail')}</p>
          </div>
        )}
      </StepLayout>
    )
  }

  const missing = missingRequiredColumns(mapping)
  const duplicates = duplicateTargets(mapping)
  const badFixes = invalidFixes(mapping)
  const blocked = missing.length > 0 || duplicates.length > 0 || badFixes.length > 0
  const columnLabel = (c: CanonicalColumn) => t(`columns.${c}`)

  const confirm = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const res = await api.apply({ uploadId: upload.uploadId, mapping })
      setDraft((d) => ({ ...d, quality: res.quality }))
      onStateChange(await api.state())
      onDone()
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'mapping', error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('mapping.title')}
      description={t('mapping.description', {
        file: upload.fileName,
        rows: formatInt(upload.profile.rowCount, lang),
      })}
      footer={
        <>
          {footerBack}
          <BusyButton
            busy={busy}
            busyLabel={t('mapping.applying')}
            onClick={confirm}
            disabled={blocked}
            aria-describedby={blocked ? 'mapping-blocked' : undefined}
          >
            {t('mapping.confirm')}
          </BusyButton>
        </>
      }
    >
      <SourceNote source={proposal.source} warnings={proposal.warnings} notes={mapping.notes} />

      {blocked && (
        <div id="mapping-blocked" role="alert" className="rounded-md bg-negative-soft px-3 py-2 text-sm text-negative">
          {missing.length > 0 && <p>{t('mapping.missingRequired', { columns: missing.map(columnLabel).join(', ') })}</p>}
          {duplicates.length > 0 && <p>{t('mapping.duplicates', { columns: duplicates.map(columnLabel).join(', ') })}</p>}
          {badFixes.length > 0 && <p>{t('mapping.emptyFix', { values: badFixes.map((f) => f.from).join(', ') })}</p>}
        </div>
      )}

      <ColumnTable mapping={mapping} update={update} profile={upload.profile} />

      <FormatSelects mapping={mapping} update={update} />

      <ValueFixes mapping={mapping} update={update} profile={upload.profile} />

      <BranchCoordinates mapping={mapping} update={update} />

      <InlineStatus status={status} />
    </StepLayout>
  )
}

function SourceNote({ source, warnings, notes }: { source: ProposeResponse['source']; warnings: Notice[]; notes: string[] }) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  // Notices are translated from their code. Their detail text and core's mapping notes (ambiguous dates/numbers)
  // are English diagnostics, shown under a localised headline rather than hidden.
  const details = [...warnings.flatMap((w) => (w.detail ? [w.detail] : [])), ...notes]
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={source === 'heuristic' ? 'outline' : 'secondary'}>{t(`mapping.source.${source}`)}</Badge>
        <p className="text-sm">{t(`mapping.sourceBody.${source}`)}</p>
      </div>
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={w.code}>{t(`mapping.notice.${w.code}`)}</li>
          ))}
        </ul>
      )}
      {details.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 py-3 text-muted-foreground md:min-h-0 md:py-1">
            {t('mapping.details', { n: formatInt(details.length, lang) })}
          </summary>
          <ul lang="en" className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ColumnTable({ mapping, update, profile }: { mapping: Mapping; update: (m: Mapping) => void; profile: DataProfile }) {
  const { t } = useTranslation('onboarding')
  const headers = Object.keys(mapping.columnMap)
  const duplicates = new Set(duplicateTargets(mapping))

  return (
    <section aria-labelledby="mapping-columns" className="flex flex-col gap-3">
      <div>
        <h4 id="mapping-columns" className="text-sm font-semibold">
          {t('mapping.columnsTitle')}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">{t('mapping.columnsHint')}</p>
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_16rem] gap-3 border-b pb-2 text-xs text-muted-foreground md:grid">
        <span>{t('mapping.headerInFile')}</span>
        <span>{t('mapping.readAs')}</span>
      </div>
      <ul className="flex flex-col gap-2 md:gap-0">
        {headers.map((header) => {
          const target = mapping.columnMap[header] ?? null
          const required = target !== null && isRequired(target)
          const duplicate = target !== null && duplicates.has(target)
          // A sample value tells "Nilai" (an amount) from "Nama" (a name) when the header itself is unclear.
          const sample = profile.sampleRows[0]?.[profile.headers.indexOf(header)]?.trim()
          return (
            <li
              key={header}
              className="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center md:gap-3 md:rounded-none md:border-0 md:border-b md:px-0 md:py-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-medium break-all">{header}</span>
                {required && <Badge variant="secondary">{t('mapping.required')}</Badge>}
                {target === null && <span className="text-xs text-muted-foreground">{t('mapping.ignored')}</span>}
                {sample && (
                  <span className="basis-full truncate text-xs text-muted-foreground">{t('mapping.example', { value: sample })}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Select
                  value={target ?? IGNORE}
                  onValueChange={(v) => update(setColumn(mapping, header, v === IGNORE ? null : (v as CanonicalColumn)))}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t('mapping.readAsFor', { header })}
                    aria-invalid={duplicate || undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE}>{t('mapping.ignore')}</SelectItem>
                    {CANONICAL_COLUMNS.map((column) => (
                      <SelectItem key={column} value={column}>
                        {isRequired(column)
                          ? t('mapping.requiredOption', { column: t(`columns.${column}`) })
                          : t(`columns.${column}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {duplicate && <p className="text-xs text-negative">{t('mapping.duplicateRow')}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FormatSelects({ mapping, update }: { mapping: Mapping; update: (m: Mapping) => void }) {
  const { t } = useTranslation('onboarding')
  const ids = { date: useFieldId('date-format'), number: useFieldId('number-format') }
  return (
    <section aria-labelledby="mapping-formats" className="flex flex-col gap-3">
      <h4 id="mapping-formats" className="text-sm font-semibold">
        {t('mapping.formatsTitle')}
      </h4>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('mapping.dateFormat')} htmlFor={ids.date} hint={t('mapping.dateFormatHint')}>
          <Select value={mapping.dateFormat} onValueChange={(v) => update({ ...mapping, dateFormat: v as DateFormat })}>
            <SelectTrigger id={ids.date} className="w-full" aria-describedby={`${ids.date}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`mapping.dateFormats.${DATE_FORMAT_KEYS[f]}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('mapping.numberFormat')} htmlFor={ids.number} hint={t('mapping.numberFormatHint')}>
          <Select
            value={mapping.numberFormat}
            onValueChange={(v) => update({ ...mapping, numberFormat: v as NumberFormat })}
          >
            <SelectTrigger id={ids.number} className="w-full" aria-describedby={`${ids.number}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NUMBER_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`mapping.numberFormats.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </section>
  )
}

function ValueFixes({ mapping, update, profile }: { mapping: Mapping; update: (m: Mapping) => void; profile: DataProfile }) {
  const { t } = useTranslation('onboarding')
  const fixes = valueFixes(mapping, profile)
  const groups = MAPPABLE_COLUMNS.map((column) => ({ column, fixes: fixes.filter((f) => f.column === column) })).filter(
    (g) => g.fixes.length > 0,
  )

  return (
    <section aria-labelledby="mapping-values" className="flex flex-col gap-3">
      <div>
        <h4 id="mapping-values" className="text-sm font-semibold">
          {t('mapping.valuesTitle')}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">{t('mapping.valuesHint')}</p>
      </div>

      {groups.length === 0 && <p className="text-sm text-muted-foreground">{t('mapping.noFixes')}</p>}

      {groups.map((group) => (
        <div key={group.column} className="flex flex-col gap-2">
          <h5 className="text-sm font-medium">{t(`columns.${group.column}`)}</h5>
          <ul className="flex flex-col gap-2">
            {group.fixes.map((fix) => (
              <FixRow key={fix.from} fix={fix} mapping={mapping} update={update} />
            ))}
          </ul>
        </div>
      ))}

      <AddFix mapping={mapping} update={update} profile={profile} />
    </section>
  )
}

function FixRow({ fix, mapping, update }: { fix: ValueFix; mapping: Mapping; update: (m: Mapping) => void }) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-card p-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_7rem_auto]">
      <span className="col-span-2 text-sm font-medium break-all md:col-span-1">{fix.from}</span>
      <ArrowRight className="hidden size-4 text-muted-foreground md:block" aria-hidden="true" />
      <Input
        value={fix.to}
        onChange={(e) => update(setValueFix(mapping, fix.column, fix.from, e.target.value))}
        aria-label={t('mapping.fixTarget', { from: fix.from })}
        aria-invalid={fix.to.trim() === '' || undefined}
        className="min-w-0"
      />
      <span className="order-last col-span-2 text-xs text-muted-foreground tabular md:order-none md:col-span-1 md:text-right">
        {fix.rows === null ? t('mapping.rowsUnknown') : t('mapping.rows', { count: fix.rows, n: formatInt(fix.rows, lang) })}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => update(removeValueFix(mapping, fix.column, fix.from))}
        aria-label={t('mapping.removeFix', { from: fix.from })}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  )
}

function AddFix({ mapping, update, profile }: { mapping: Mapping; update: (m: Mapping) => void; profile: DataProfile }) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  const ids = { column: useFieldId('fix-column'), from: useFieldId('fix-from'), to: useFieldId('fix-to') }
  const columns = MAPPABLE_COLUMNS.filter((c) => distinctFor(profile, mapping, c).length > 0)
  const [column, setColumnChoice] = useState<MappableColumn | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const taken = new Set(column ? Object.keys(mapping.valueMap[column] ?? {}) : [])
  const candidates = column ? distinctFor(profile, mapping, column).filter((d) => !taken.has(d.value)) : []
  const canAdd = column !== '' && from !== '' && to.trim() !== '' && to.trim() !== from

  if (columns.length === 0) return null

  const add = () => {
    if (!canAdd) return
    update(setValueFix(mapping, column, from, to.trim()))
    setFrom('')
    setTo('')
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">{t('mapping.addTitle')}</p>
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Field label={t('mapping.addColumn')} htmlFor={ids.column}>
          <Select
            value={column}
            onValueChange={(v) => {
              setColumnChoice(v as MappableColumn)
              setFrom('')
            }}
          >
            <SelectTrigger id={ids.column} className="w-full">
              <SelectValue placeholder={t('mapping.pick')} />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`columns.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('mapping.addFrom')} htmlFor={ids.from}>
          <Select value={from} onValueChange={setFrom} disabled={!column}>
            <SelectTrigger id={ids.from} className="w-full">
              <SelectValue placeholder={t('mapping.pick')} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {t('mapping.valueWithRows', { value: d.value, n: formatInt(d.count, lang) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('mapping.addTo')} htmlFor={ids.to}>
          <Input
            id={ids.to}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            disabled={!from}
            autoComplete="off"
          />
        </Field>
        <Button variant="outline" onClick={add} disabled={!canAdd}>
          <Plus aria-hidden="true" />
          {t('mapping.add')}
        </Button>
      </div>
    </div>
  )
}

function BranchCoordinates({ mapping, update }: { mapping: Mapping; update: (m: Mapping) => void }) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  const entries = Object.entries(mapping.branchGeo).sort(([a], [b]) => a.localeCompare(b))
  const coord = new Intl.NumberFormat(LOCALE_TAG[lang], { minimumFractionDigits: 2, maximumFractionDigits: 4 })

  return (
    <section aria-labelledby="mapping-geo" className="flex flex-col gap-3">
      <div>
        <h4 id="mapping-geo" className="text-sm font-semibold">
          {t('mapping.geoTitle')}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {entries.length > 0 ? t('mapping.geoHint') : t('mapping.geoNone')}
        </p>
      </div>
      {entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map(([branch, point]) => (
            <li key={branch} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-all">{branch}</p>
                <p className="text-xs text-muted-foreground tabular">
                  {t('mapping.geoPoint', { lat: coord.format(point.lat), lon: coord.format(point.lon) })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => update(removeBranchGeo(mapping, branch))}
                aria-label={t('mapping.removeGeo', { branch })}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
