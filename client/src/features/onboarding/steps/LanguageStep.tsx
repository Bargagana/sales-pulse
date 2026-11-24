import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Lang } from '@core/types'
import { useLanguageSwitch } from '@/components/layout'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { messageForError } from '../errors'
import { BusyButton, FooterStart, InlineStatus, StepLayout, useFieldId, type Status } from '../parts'
import type { StepProps } from '../types'

const LANGS: Lang[] = ['id', 'en']

export function LanguageStep({ mode, state, onStateChange, back, onDone }: StepProps) {
  const { t } = useTranslation('onboarding')
  const [lang, setLang] = useState<Lang>(state.lang)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const switchLanguage = useLanguageSwitch(state, onStateChange)
  const groupId = useFieldId('lang')

  // Picking a language shows the rest of onboarding in it straight away; it is saved by the button (initial)
  // or immediately (settings, where there is no step to finish).
  const choose = (next: Lang) => {
    setLang(next)
    setStatus(null)
    if (mode === 'settings') void switchLanguage(next)
    else void i18n.changeLanguage(next)
  }

  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      onStateChange(await api.setLanguage(lang))
      onDone()
    } catch (error) {
      setStatus({ tone: 'error', text: messageForError(t, 'language', error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('language.title')}
      description={t('language.description')}
      footer={
        <>
          <FooterStart>{back}</FooterStart>
          {mode === 'initial' && (
            <BusyButton busy={busy} busyLabel={t('language.saving')} onClick={save}>
              {t('language.save', { language: t(`common:language.${lang}`) })}
            </BusyButton>
          )}
        </>
      }
    >
      <RadioGroup
        value={lang}
        onValueChange={(v) => choose(v as Lang)}
        aria-label={t('language.title')}
        className="grid gap-3 sm:grid-cols-2"
      >
        {LANGS.map((code) => (
          <label
            key={code}
            htmlFor={`${groupId}-${code}`}
            className={cn(
              'flex min-h-16 items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent',
              lang === code && 'border-primary bg-primary-soft hover:bg-primary-soft',
            )}
          >
            <RadioGroupItem id={`${groupId}-${code}`} value={code} className="mt-0.5" />
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold" lang={code}>
                {t(`common:language.${code}`)}
              </span>
              <span className="text-sm text-muted-foreground">{t(`language.option.${code}`)}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <InlineStatus status={status} />
    </StepLayout>
  )
}
