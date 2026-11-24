import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import type { Lang } from '@core/types'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export interface AppShellProps {
  /** Data-period badge (see PeriodBadge). In the header from `sm` up; above the content on phones. */
  period?: ReactNode
  /** Primary page actions, e.g. "Send to Telegram". Keep to one or two; give them short labels on phones. */
  actions?: ReactNode
  /** Shows the ID/EN toggle when provided. */
  lang?: Lang
  onLangChange?: (lang: Lang) => void
  /** Shows the settings button when provided. */
  onOpenSettings?: () => void
  children?: ReactNode
  className?: string
}

/** Page frame: sticky header with product name, period, actions, language and settings; centred content. */
export function AppShell({ period, actions, lang, onLangChange, onOpenSettings, children, className }: AppShellProps) {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('skipToContent')}
      </a>

      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center gap-2 px-4 md:h-16 md:gap-3 md:px-6">
          <h1 className="shrink-0 text-base font-semibold tracking-tight md:text-lg">{t('appName')}</h1>
          {period && <div className="hidden min-w-0 sm:block">{period}</div>}

          <div className="ml-auto flex min-w-0 items-center gap-1.5 md:gap-2">
            {actions}
            {lang && onLangChange && <LanguageToggle lang={lang} onChange={onLangChange} />}
            {onOpenSettings && (
              <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label={t('actions.settings')}>
                <Settings aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className={cn('mx-auto w-full max-w-screen-2xl flex-1 px-4 py-4 outline-none md:px-6 md:py-6', className)}>
        {period && <div className="mb-4 sm:hidden">{period}</div>}
        {children}
      </main>
    </div>
  )
}

export function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  const { t } = useTranslation('common')

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={lang}
      // Radix sends '' when the active item is pressed again; a language toggle always has a value.
      onValueChange={(value) => {
        if (value === 'id' || value === 'en') onChange(value)
      }}
      aria-label={t('language.switch')}
    >
      {(['id', 'en'] as const).map((code) => (
        <ToggleGroupItem
          key={code}
          value={code}
          aria-label={t(`language.${code}`)}
          className="min-w-11 font-semibold data-[state=on]:bg-primary-soft data-[state=on]:text-primary"
        >
          {t(`language.short.${code}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
