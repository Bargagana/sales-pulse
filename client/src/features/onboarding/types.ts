import type { ReactNode } from 'react'
import type { AppState, ProposeResponse } from '@core/api-types'
import type { DataProfile, Mapping, QualityReport } from '@core/types'

export type OnboardingMode = 'initial' | 'settings'

/** What every step receives from the dialog shell. */
export interface StepProps {
  mode: OnboardingMode
  state: AppState
  onStateChange: (next: AppState) => void
  /** Footer Back button; absent on the first step and on settings tabs. */
  back?: ReactNode
  /** The step succeeded: the shell moves on (initial) or shows the next sub-step (settings data flow). */
  onDone: () => void
}

export interface UploadInfo {
  uploadId: string
  profile: DataProfile
  fileName: string
}

/**
 * The data -> mapping -> quality hand-over lives in client memory: the server keeps the upload by id only,
 * and the proposal is the user's draft until they confirm it.
 */
export interface DataDraft {
  upload: UploadInfo | null
  proposal: ProposeResponse | null
  mapping: Mapping | null
  quality: QualityReport | null
}

export const EMPTY_DRAFT: DataDraft = { upload: null, proposal: null, mapping: null, quality: null }
