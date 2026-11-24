import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { messageForError, messageForResult } from '../errors'
import { BusyButton, Field, FooterStart, InlineStatus, SecretInput, StepLayout, useFieldId, type Status } from '../parts'
import type { StepProps } from '../types'

const BOTFATHER_URL = 'https://t.me/BotFather'

export function TelegramStep({ mode, state, onStateChange, back, onDone }: StepProps) {
  const { t } = useTranslation('onboarding')
  const saved = state.telegram
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState(saved?.chatId ?? '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [showErrors, setShowErrors] = useState(false)
  const ids = { token: useFieldId('bot-token'), chat: useFieldId('chat-id') }

  const errors = {
    token: !saved?.hasToken && botToken.trim() === '' ? t('telegram.errors.token') : null,
    chat: chatId.trim() === '' ? t('telegram.errors.chat') : null,
  }
  const dirty = !saved || botToken !== '' || chatId.trim() !== saved.chatId
  const canContinue = mode === 'initial' && state.completed.telegram && !dirty

  const send = async () => {
    setShowErrors(true)
    if (errors.token || errors.chat) return
    setBusy(true)
    setStatus(null)
    try {
      const result = await api.configureTelegram({ botToken: botToken.trim() || undefined, chatId: chatId.trim() })
      if (!result.ok) {
        setStatus({ tone: 'error', text: messageForResult(t, 'telegram', result) })
        return
      }
      setBotToken('')
      setStatus({ tone: 'success', text: t('telegram.sent') })
      // In the initial flow this state usually has onboarded=true, and App swaps the dialog for the dashboard.
      onStateChange(await api.state())
      if (mode === 'initial') onDone()
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'telegram', error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('telegram.title')}
      description={t('telegram.description')}
      footer={
        <>
          <FooterStart>{back}</FooterStart>
          {canContinue ? (
            <Button onClick={onDone}>{t('actions.continue')}</Button>
          ) : (
            <BusyButton busy={busy} busyLabel={t('telegram.sending')} onClick={send}>
              {t('telegram.send')}
            </BusyButton>
          )}
        </>
      }
    >
      <ol className="flex flex-col gap-3">
        {(['create', 'start', 'chatId'] as const).map((key, i) => (
          <li key={key} className="flex gap-3">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary tabular"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{t(`telegram.guide.${key}.title`)}</p>
              <p className="mt-0.5 text-muted-foreground break-words">
                <Trans
                  t={t}
                  i18nKey={`telegram.guide.${key}.body`}
                  components={{
                    bot: (
                      <a
                        href={BOTFATHER_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-primary underline underline-offset-2"
                      />
                    ),
                    code: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground" />,
                  }}
                />
              </p>
            </div>
          </li>
        ))}
      </ol>

      <form
        className="grid gap-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Field
          label={t('telegram.token')}
          htmlFor={ids.token}
          hint={saved?.hasToken ? t('telegram.tokenSavedHint') : t('telegram.tokenHint')}
          error={showErrors ? errors.token : null}
        >
          <SecretInput
            id={ids.token}
            value={botToken}
            onChange={(v) => {
              setBotToken(v)
              setStatus(null)
            }}
            placeholder={saved?.hasToken ? t('telegram.tokenSaved') : undefined}
            describedBy={`${ids.token}-hint`}
            invalid={showErrors && !!errors.token}
          />
        </Field>
        <Field
          label={t('telegram.chatId')}
          htmlFor={ids.chat}
          hint={t('telegram.chatIdHint')}
          error={showErrors ? errors.chat : null}
        >
          <Input
            id={ids.chat}
            value={chatId}
            onChange={(e) => {
              setChatId(e.target.value)
              setStatus(null)
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={(showErrors && !!errors.chat) || undefined}
            aria-describedby={`${ids.chat}-hint`}
          />
        </Field>
        <button type="submit" hidden />
      </form>

      <InlineStatus status={status} />
    </StepLayout>
  )
}
