import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LlmFormat } from '@core/api-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { messageForError, messageForResult } from '../errors'
import { DEFAULT_BASE_URL } from '../flow'
import { BusyButton, Field, FooterStart, InlineStatus, SecretInput, StepLayout, useFieldId, type Status } from '../parts'
import type { StepProps } from '../types'

const FORMATS: LlmFormat[] = ['openai', 'anthropic']

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function LlmStep({ mode, state, onStateChange, back, onDone }: StepProps) {
  const { t } = useTranslation('onboarding')
  const saved = state.llm
  const [format, setFormat] = useState<LlmFormat>(saved?.format ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? DEFAULT_BASE_URL.openai)
  const [model, setModel] = useState(saved?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [showErrors, setShowErrors] = useState(false)
  const ids = { format: useFieldId('format'), url: useFieldId('url'), key: useFieldId('key'), model: useFieldId('model') }

  const dirty =
    !saved || apiKey !== '' || format !== saved.format || baseUrl.trim() !== saved.baseUrl || model.trim() !== saved.model
  const keyRequired = !saved?.hasKey
  const errors = {
    url: isHttpUrl(baseUrl.trim()) ? null : t('llm.errors.url'),
    key: keyRequired && apiKey.trim() === '' ? t('llm.errors.key') : null,
    model: model.trim() === '' ? t('llm.errors.model') : null,
  }
  const valid = !errors.url && !errors.key && !errors.model

  // Swap in the other format's default URL only if the user has not typed their own (e.g. an OpenRouter URL).
  const changeFormat = (next: LlmFormat) => {
    if (baseUrl.trim() === '' || baseUrl.trim() === DEFAULT_BASE_URL[format]) setBaseUrl(DEFAULT_BASE_URL[next])
    setFormat(next)
    setStatus(null)
  }

  const test = async () => {
    setShowErrors(true)
    if (!valid) return
    setBusy(true)
    setStatus(null)
    try {
      const result = await api.configureLlm({
        format,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      })
      if (!result.ok) {
        setStatus({
          tone: 'error',
          text: messageForResult(t, 'llm', result),
          detail: result.detail ? t('llm.detail', { detail: result.detail }) : undefined,
        })
        return
      }
      setApiKey('')
      onStateChange(await api.state())
      if (mode === 'initial') onDone()
      else setStatus({ tone: 'success', text: t('llm.saved', { model: model.trim() }) })
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'llm', error) })
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (key: keyof typeof errors) => (showErrors ? errors[key] : null)
  const canContinue = mode === 'initial' && state.completed.llm && !dirty

  return (
    <StepLayout
      title={t('llm.title')}
      description={t('llm.description')}
      footer={
        <>
          <FooterStart>{back}</FooterStart>
          {canContinue ? (
            <Button onClick={onDone}>{t('actions.continue')}</Button>
          ) : (
            <BusyButton busy={busy} busyLabel={t('llm.testing')} onClick={test}>
              {t('llm.test')}
            </BusyButton>
          )}
        </>
      }
    >
      <form
        className="grid gap-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void test()
        }}
      >
        <Field label={t('llm.format')} htmlFor={ids.format} hint={t(`llm.formatHint.${format}`)}>
          <Select value={format} onValueChange={(v) => changeFormat(v as LlmFormat)}>
            <SelectTrigger id={ids.format} className="w-full" aria-describedby={`${ids.format}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`llm.formats.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('llm.baseUrl')} htmlFor={ids.url} hint={t('llm.baseUrlHint')} error={fieldError('url')}>
          <Input
            id={ids.url}
            type="url"
            inputMode="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              setStatus(null)
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!fieldError('url')}
            aria-describedby={`${ids.url}-hint`}
          />
        </Field>

        <Field
          label={t('llm.apiKey')}
          htmlFor={ids.key}
          hint={saved?.hasKey ? t('llm.keySavedHint') : t('llm.keyHint')}
          error={fieldError('key')}
        >
          <SecretInput
            id={ids.key}
            value={apiKey}
            onChange={(v) => {
              setApiKey(v)
              setStatus(null)
            }}
            placeholder={saved?.hasKey ? t('llm.keySaved') : undefined}
            describedBy={`${ids.key}-hint`}
            invalid={!!fieldError('key')}
          />
        </Field>

        <Field label={t('llm.model')} htmlFor={ids.model} hint={t(`llm.modelHint.${format}`)} error={fieldError('model')}>
          <Input
            id={ids.model}
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              setStatus(null)
            }}
            placeholder={t(`llm.modelPlaceholder.${format}`)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!fieldError('model')}
            aria-describedby={`${ids.model}-hint`}
          />
        </Field>
        {/* Lets Enter in any field run the test, like the footer button. */}
        <button type="submit" hidden />
      </form>

      <InlineStatus status={status} />
      <p className="text-xs text-muted-foreground">{t('llm.privacy')}</p>
    </StepLayout>
  )
}
