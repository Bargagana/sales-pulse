import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { messageForError } from './errors'
import { curlExample, maskToken } from './flow'
import { BusyButton, CopyButton, InlineStatus, useFieldId, type Status } from './parts'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; token: string }

/** PRD §6.7: the push token and a curl call that works as pasted. Shown in onboarding step 3 and in Settings. */
export function PushApiPanel() {
  const { t } = useTranslation('onboarding')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [revealed, setRevealed] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const titleId = useFieldId('push-title')

  const fetchToken = () => {
    setLoad({ status: 'loading' })
    api.pushToken().then(
      ({ token }) => setLoad({ status: 'ready', token }),
      (error: unknown) => setLoad({ status: 'error', message: messageForError(t, 'push', error) }),
    )
  }
  // Fetch once on mount; a language switch (new `t`) must not refetch the token.
  useEffect(fetchToken, [])

  const rotate = async () => {
    setRotating(true)
    try {
      const { token } = await api.rotatePushToken()
      setLoad({ status: 'ready', token })
      setStatus({ tone: 'success', text: t('push.rotated') })
      setConfirmRotate(false)
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'push', error) })
      setConfirmRotate(false)
    } finally {
      setRotating(false)
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const token = load.status === 'ready' ? load.token : ''
  const shown = revealed ? token : maskToken(token)

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border bg-background p-4">
      <div>
        <h4 id={titleId} className="text-sm font-semibold">
          {t('push.title')}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">{t('push.description')}</p>
      </div>

      {load.status === 'loading' && (
        <div role="status" aria-label={t('push.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full md:h-9" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {load.status === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <InlineStatus status={{ tone: 'error', text: load.message }} className="flex-1" />
          <Button variant="outline" size="sm" onClick={fetchToken}>
            {t('common:actions.retry')}
          </Button>
        </div>
      )}

      {load.status === 'ready' && (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {t('push.token')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                className="min-w-0 basis-full rounded-md border bg-card px-3 py-2 font-mono text-xs break-all md:basis-0 md:flex-1 md:text-sm"
              >
                {shown}
              </code>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setRevealed((v) => !v)}
                  aria-label={revealed ? t('push.hideToken') : t('push.showToken')}
                  aria-pressed={revealed}
                >
                  {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
                <CopyButton text={token} label={t('push.copyToken')} />
                <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
                  <RefreshCw aria-hidden="true" />
                  {t('push.rotate')}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('push.example')}</p>
              {/* Copies the real token even while the screen shows it masked. */}
              <CopyButton text={curlExample(origin, token)} label={t('push.copyCurl')} />
            </div>
            <pre className="rounded-md border bg-card p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
              {curlExample(origin, shown)}
            </pre>
            <p className="text-xs text-muted-foreground">{t('push.exampleHint')}</p>
          </div>
        </>
      )}

      <InlineStatus status={status} />

      <Dialog open={confirmRotate} onOpenChange={(open) => !rotating && setConfirmRotate(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('push.rotateTitle')}</DialogTitle>
            <DialogDescription>{t('push.rotateBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(false)} disabled={rotating}>
              {t('common:actions.cancel')}
            </Button>
            <BusyButton busy={rotating} busyLabel={t('push.rotating')} onClick={rotate}>
              {t('push.rotateConfirm')}
            </BusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
