// Small building blocks shared by the onboarding steps.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CircleCheck, Copy, Eye, EyeOff, LoaderCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { Lang } from '@core/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Body + footer of one step. The body scrolls and the footer stays put; both sit in the dialog's flex column
 * (not position: fixed), so on a phone the footer rides above the on-screen keyboard.
 */
export function StepLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <h3 className="text-base font-semibold tracking-tight md:text-lg">{title}</h3>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        <div className="mt-5 flex flex-col gap-6">{children}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-card px-4 py-3 md:px-6">{footer}</div>
    </>
  )
}

/** Pushes the Back button to the left edge of the footer. */
export function FooterStart({ children }: { children?: ReactNode }) {
  return <div className="mr-auto">{children}</div>
}

export function BusyButton({
  busy,
  busyLabel,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { busy: boolean; busyLabel: string }) {
  return (
    <Button {...props} disabled={busy || props.disabled} aria-busy={busy || undefined}>
      {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
      {busy ? busyLabel : children}
    </Button>
  )
}

/** detail: optional technical line (English, written by our server), shown smaller under the message. */
export type Status = { tone: 'success' | 'error'; text: string; detail?: string } | null

/** Result line under an action: icon + text, never colour alone. */
export function InlineStatus({ status, className }: { status: Status; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  // Results sit under the form; on a phone that is below the fold, so bring a new result into view.
  useEffect(() => {
    if (status) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [status])

  if (!status) return null
  const success = status.tone === 'success'
  const Icon = success ? CircleCheck : TriangleAlert
  return (
    <p
      ref={ref}
      role={success ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
        success ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {status.text}
        {status.detail && <span className="mt-1 block break-words text-xs opacity-80">{status.detail}</span>}
      </span>
    </p>
  )
}

/** Label + control + one line under it: the validation error when there is one, otherwise the hint (id `${htmlFor}-hint`). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-hint`} className="flex items-start gap-1.5 text-xs text-negative">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** Password input with a show/hide toggle. The toggle sits inside the field so the row height stays one control. */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
  invalid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  describedBy?: string
  invalid?: boolean
}) {
  const { t } = useTranslation('onboarding')
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="pr-12 md:pr-10"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('secret.hide') : t('secret.show')}
        aria-pressed={visible}
        aria-controls={id}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  )
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('onboarding:push.copyFailed'))
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className={className} aria-label={label}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? t('actions.copied') : t('actions.copy')}</span>
    </Button>
  )
}

/** The language the UI is showing right now (follows the language step's preview before it is saved). */
export function useLang(): Lang {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage === 'en' ? 'en' : 'id'
}

export function useFieldId(name: string): string {
  return `${useId()}-${name}`
}
