import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Lang } from '@core/types'
import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import enOnboarding from './locales/en/onboarding.json'
import idCommon from './locales/id/common.json'
import idDashboard from './locales/id/dashboard.json'
import idOnboarding from './locales/id/onboarding.json'

export const NAMESPACES = ['common', 'onboarding', 'dashboard'] as const
export type Namespace = (typeof NAMESPACES)[number]

export const resources = {
  id: { common: idCommon, onboarding: idOnboarding, dashboard: idDashboard },
  en: { common: enCommon, onboarding: enOnboarding, dashboard: enDashboard },
} satisfies Record<Lang, Record<Namespace, object>>

/** BCP 47 tag for Intl formatting and <html lang>. */
export const LOCALE_TAG: Record<Lang, string> = { id: 'id-ID', en: 'en-US' }

// Synchronous init: resources are bundled, so the first render already has strings (no flash of keys).
void i18n.use(initReactI18next).init({
  resources,
  lng: 'id', // PRD §4: Indonesian until AppState.lang says otherwise
  fallbackLng: 'en',
  supportedLngs: ['id', 'en'],
  ns: [...NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  initAsync: false,
})

if (typeof document !== 'undefined') {
  // Screen readers pick their voice from <html lang>.
  const syncHtmlLang = (lng: string) => {
    document.documentElement.lang = lng
  }
  syncHtmlLang(i18n.language)
  i18n.on('languageChanged', syncHtmlLang)
}

export function currentLang(): Lang {
  return i18n.resolvedLanguage === 'en' ? 'en' : 'id'
}

export default i18n
