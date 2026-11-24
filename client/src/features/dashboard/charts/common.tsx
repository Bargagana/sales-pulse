import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Lang } from '@core/types'
import { Button } from '@/components/ui/button'
import { chartFormatters } from '@/theme'

export interface ChartBaseProps {
  lang: Lang
  isPhone: boolean
  /** Shown in every empty state: the one action that brings data back. */
  onClearFilters: () => void
}

/** Apex click handler options: seriesIndex / dataPointIndex of the clicked mark. */
export interface PointRef {
  seriesIndex: number
  dataPointIndex: number
}

export function useFormatters(lang: Lang) {
  return useMemo(() => chartFormatters(lang), [lang])
}

/** Empty-state config for ChartCard: says why it is empty and offers "clear filters". */
export function useEmptyState(onClearFilters: () => void) {
  const { t } = useTranslation('common')
  return useMemo(
    () => ({
      action: (
        <Button variant="outline" onClick={onClearFilters}>
          {t('actions.clearFilters')}
        </Button>
      ),
    }),
    [onClearFilters, t],
  )
}

/** Escapes text from the data before it goes into a chart tooltip that renders HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
