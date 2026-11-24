import { useCallback } from 'react'
import { toast } from 'sonner'
import type { AppState } from '@core/api-types'
import type { Lang } from '@core/types'
import i18n from '@/i18n'
import { api } from '@/lib/api'

/**
 * Language switch for the header toggle: the UI changes at once, then the choice is saved on the server.
 * If saving fails the UI stays in the chosen language and the user is told it was not saved.
 */
export function useLanguageSwitch(state: AppState, onStateChange: (next: AppState) => void) {
  return useCallback(
    async (lang: Lang) => {
      if (lang === state.lang) return
      await i18n.changeLanguage(lang)
      try {
        onStateChange(await api.setLanguage(lang))
      } catch {
        onStateChange({ ...state, lang })
        // i18n.t, not the hook's t: that one is bound to the language of the last render.
        toast.error(i18n.t('common:error.languageNotSaved'))
      }
    },
    [onStateChange, state],
  )
}
