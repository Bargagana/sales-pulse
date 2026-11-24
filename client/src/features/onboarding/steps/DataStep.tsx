import { useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { formatInt } from '@core/index'
import { formatDateRange } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { messageForError } from '../errors'
import { formatBytes } from '../flow'
import { BusyButton, FooterStart, InlineStatus, StepLayout, useFieldId, useLang, type Status } from '../parts'
import { PushApiPanel } from '../PushApiPanel'
import type { StepProps, UploadInfo } from '../types'

/** Same cap as the server (PRD §6.7 upload body limit); checked here so a big file fails before it is sent. */
const MAX_BYTES = 20 * 1024 * 1024

export function DataStep({
  mode,
  state,
  onStateChange,
  back,
  onDone,
  upload,
  onUploaded,
}: StepProps & { upload: UploadInfo | null; onUploaded: (upload: UploadInfo) => void }) {
  const { t } = useTranslation('onboarding')
  const lang = useLang()
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useFieldId('csv')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const pick = (next: File | undefined) => {
    setStatus(null)
    if (!next) return
    if (!/\.(csv|txt|tsv)$/i.test(next.name)) {
      setFile(null)
      setStatus({ tone: 'error', text: t('data.notCsv', { name: next.name }) })
      return
    }
    if (next.size > MAX_BYTES) {
      setFile(null)
      setStatus({ tone: 'error', text: t('errors.data.payload_too_large') })
      return
    }
    setFile(next)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files[0])
  }

  const send = async () => {
    if (!file) return
    setBusy(true)
    setStatus(null)
    try {
      const res = await api.uploadCsv(file)
      onUploaded({ uploadId: res.uploadId, profile: res.profile, fileName: file.name })
      onStateChange(await api.state())
      onDone()
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'data', error) })
    } finally {
      setBusy(false)
    }
  }

  // An upload from earlier in this session can go straight to mapping; picking a new file replaces it.
  const canContinue = upload !== null && file === null

  return (
    <StepLayout
      title={mode === 'settings' ? t('data.settingsTitle') : t('data.title')}
      description={t('data.description')}
      footer={
        <>
          <FooterStart>{back}</FooterStart>
          {canContinue ? (
            <Button onClick={onDone}>{t('data.continue')}</Button>
          ) : (
            <BusyButton busy={busy} busyLabel={t('data.uploading')} onClick={send} disabled={!file}>
              {t('data.upload')}
            </BusyButton>
          )}
        </>
      }
    >
      {state.dataset && (
        <p className="text-sm text-muted-foreground">
          {t('data.active', {
            rows: formatInt(state.dataset.rowCount, lang),
            period: formatDateRange(state.dataset.periods.from, state.dataset.periods.to, lang),
          })}
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center transition-colors',
          dragging && 'border-primary bg-primary-soft',
        )}
      >
        {file ? (
          <>
            <FileSpreadsheet className="size-6 text-primary" aria-hidden="true" />
            <p className="max-w-full text-sm font-medium break-all">{file.name}</p>
            <p className="text-sm text-muted-foreground tabular">{formatBytes(file.size, lang)}</p>
          </>
        ) : upload ? (
          <>
            <FileSpreadsheet className="size-6 text-primary" aria-hidden="true" />
            <p className="max-w-full text-sm font-medium break-all">{upload.fileName}</p>
            <p className="text-sm text-muted-foreground">
              {t('data.uploaded', {
                rows: formatInt(upload.profile.rowCount, lang),
                columns: formatInt(upload.profile.headers.length, lang),
              })}
            </p>
          </>
        ) : (
          <>
            <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">{t('data.drop')}</p>
            <p className="text-sm text-muted-foreground">{t('data.dropHint')}</p>
          </>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('data.choose')}
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = '' // picking the same file again must fire onChange
          }}
        />
        <Button variant="outline" onClick={() => inputRef.current?.click()}>
          {file || upload ? t('data.chooseOther') : t('data.choose')}
        </Button>
      </div>

      <InlineStatus status={status} />

      <PushApiPanel />
    </StepLayout>
  )
}
