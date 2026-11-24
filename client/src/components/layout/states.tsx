import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Why it is empty, in the user's terms ("No sales match these filters"). */
  title: string
  /** What to do next. */
  description?: string
  /** The one action that fills it (clear filters, upload data). */
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

interface ErrorStateProps {
  title?: string
  /** What failed, in plain language. Falls back to a generic message. */
  message?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}

export function ErrorState({ title, message, onRetry, retrying = false, className }: ErrorStateProps) {
  const { t } = useTranslation('common')

  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
      <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title ?? t('error.title')}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message ?? t('error.generic')}</p>
      {onRetry && (
        <Button variant="outline" className="mt-2" onClick={onRetry} disabled={retrying}>
          {retrying && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {retrying ? t('status.retrying') : t('actions.retry')}
        </Button>
      )}
    </div>
  )
}

export function FullPageLoader({ label }: { label?: string }) {
  const { t } = useTranslation('common')

  return (
    <div role="status" className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm">{label ?? t('status.loadingApp')}</p>
    </div>
  )
}
