import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { ONBOARDING_STEPS, type OnboardingStep } from '@core/api-types'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { stepIndex } from './flow'

/**
 * Desktop: numbered row with names and a "Done" word under finished steps.
 * Phone: "Step 2 of 6" + name + progress bar, because six names do not fit in 343 px.
 */
export function Stepper({ current, completed }: { current: OnboardingStep; completed: Record<OnboardingStep, boolean> }) {
  const { t } = useTranslation('onboarding')
  const index = stepIndex(current)
  const total = ONBOARDING_STEPS.length

  return (
    <nav aria-label={t('stepper.label')}>
      <div className="md:hidden">
        <p className="text-sm">
          <span className="text-muted-foreground">{t('stepper.position', { n: index + 1, total })}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            {' · '}
          </span>
          <span className="font-medium">{t(`steps.${current}`)}</span>
        </p>
        <Progress value={((index + 1) / total) * 100} className="mt-2" aria-label={t('stepper.position', { n: index + 1, total })} />
      </div>

      <ol className="hidden grid-cols-6 gap-2 md:grid">
        {ONBOARDING_STEPS.map((step, i) => {
          const isCurrent = step === current
          const done = completed[step] && !isCurrent
          return (
            <li key={step} aria-current={isCurrent ? 'step' : undefined} className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular',
                  isCurrent && 'border-primary bg-primary text-primary-foreground',
                  done && 'border-primary bg-primary-soft text-primary',
                  !isCurrent && !done && 'border-input text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 text-xs leading-tight">
                <span className={cn('block', isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {t(`steps.${step}`)}
                </span>
                {done && <span className="block text-primary">{t('stepper.done')}</span>}
                {isCurrent && <span className="sr-only">{t('stepper.current')}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
