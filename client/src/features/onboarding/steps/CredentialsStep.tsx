import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { messageForError } from '../errors'
import { BusyButton, InlineStatus, StepLayout, type Status } from '../parts'
import type { StepProps } from '../types'

/** Settings only: PRD §6.9 "Forget credentials" deletes the encrypted file and its key. */
export function CredentialsStep({ state, onStateChange }: StepProps) {
  const { t } = useTranslation('onboarding')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const hasAny = !!state.llm || !!state.telegram

  const forget = async () => {
    setBusy(true)
    setStatus(null)
    try {
      onStateChange(await api.forgetCredentials())
      setStatus({ tone: 'success', text: t('credentials.done') })
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'credentials', error) })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <StepLayout
      title={t('credentials.title')}
      description={t('credentials.description')}
      footer={
        <Button variant="destructive" onClick={() => setConfirming(true)} disabled={!hasAny}>
          {t('credentials.forget')}
        </Button>
      }
    >
      <dl className="grid gap-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 rounded-lg border bg-card p-3">
          <dt className="font-medium">{t('credentials.llm')}</dt>
          <dd className="text-muted-foreground">
            {state.llm ? t('credentials.llmSaved', { model: state.llm.model, host: hostOf(state.llm.baseUrl) }) : t('credentials.notSaved')}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 rounded-lg border bg-card p-3">
          <dt className="font-medium">{t('credentials.telegram')}</dt>
          <dd className="text-muted-foreground">
            {state.telegram ? t('credentials.telegramSaved', { chatId: state.telegram.chatId }) : t('credentials.notSaved')}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{t('credentials.scope')}</p>
      <InlineStatus status={status} />

      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('credentials.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('credentials.confirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              {t('common:actions.cancel')}
            </Button>
            <BusyButton variant="destructive" busy={busy} busyLabel={t('credentials.forgetting')} onClick={forget}>
              {t('credentials.confirm')}
            </BusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StepLayout>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
