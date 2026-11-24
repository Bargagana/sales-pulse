// Blocking onboarding (PRD §4) and the Settings dialog that reopens the same steps.
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck } from 'lucide-react'
import type { AppState, OnboardingStep } from '@core/api-types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { nextStep, previousStep, resumeStep } from './flow'
import { StepLayout } from './parts'
import { Stepper } from './Stepper'
import { CredentialsStep } from './steps/CredentialsStep'
import { DataStep } from './steps/DataStep'
import { LanguageStep } from './steps/LanguageStep'
import { LlmStep } from './steps/LlmStep'
import { MappingStep } from './steps/MappingStep'
import { QualityStep } from './steps/QualityStep'
import { TelegramStep } from './steps/TelegramStep'
import { EMPTY_DRAFT, type DataDraft, type StepProps, type UploadInfo } from './types'

interface OnboardingProps {
  mode: 'initial' | 'settings'
  state: AppState
  onStateChange: (s: AppState) => void
  onClose?: () => void
}

export function Onboarding({ mode, state, onStateChange, onClose }: OnboardingProps): JSX.Element {
  const [draft, setDraft] = useState<DataDraft>(EMPTY_DRAFT)

  // Steps call onStateChange and then onDone in the same handler, before the new `state` prop arrives;
  // the ref lets the shell decide the next step from the state the server just returned.
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  }, [state])
  const handleState = useCallback(
    (next: AppState) => {
      latest.current = next
      onStateChange(next)
    },
    [onStateChange],
  )
  const onUploaded = useCallback((upload: UploadInfo) => setDraft({ ...EMPTY_DRAFT, upload }), [])

  const initial = mode === 'initial'

  return (
    <Dialog open onOpenChange={(open) => !open && !initial && onClose?.()}>
      <DialogContent
        showCloseButton={!initial}
        // Initial mode is a gate (PRD §4: the dashboard is unreachable until every step passes), so nothing dismisses it.
        onEscapeKeyDown={initial ? (e) => e.preventDefault() : undefined}
        onInteractOutside={initial ? (e) => e.preventDefault() : undefined}
        className="flex flex-col gap-0 overflow-hidden p-0 max-md:inset-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 sm:max-w-none md:h-[min(90dvh,860px)] md:max-w-2xl"
      >
        {initial ? (
          <InitialFlow state={state} onStateChange={handleState} latest={latest} draft={draft} setDraft={setDraft} onUploaded={onUploaded} />
        ) : (
          <SettingsFlow state={state} onStateChange={handleState} draft={draft} setDraft={setDraft} onUploaded={onUploaded} />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface FlowProps {
  state: AppState
  onStateChange: (s: AppState) => void
  draft: DataDraft
  setDraft: (update: (draft: DataDraft) => DataDraft) => void
  onUploaded: (upload: UploadInfo) => void
}

function Header({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <DialogHeader className="shrink-0 gap-1 border-b px-4 pt-4 pb-3 text-left sm:text-left md:px-6 md:pt-5">
      {/* Right padding keeps the title clear of the close button. */}
      <DialogTitle className="pr-10">{title}</DialogTitle>
      {/* On a phone the step body needs the height more than this sentence; screen readers still get it. */}
      <DialogDescription className="pr-10 max-md:sr-only">{description}</DialogDescription>
      {children && <div className="mt-3">{children}</div>}
    </DialogHeader>
  )
}

function InitialFlow({ state, onStateChange, latest, draft, setDraft, onUploaded }: FlowProps & { latest: RefObject<AppState> }) {
  const { t } = useTranslation('onboarding')
  const [step, setStep] = useState<OnboardingStep>(() => resumeStep(state.completed, false))

  // Going forward, the step that just succeeded produced what the next one needs (onDone runs before this
  // render's `draft` sees a new upload, so it must not be consulted here).
  const onDone = () => {
    const next = nextStep(step)
    // After the last step, any step still open (e.g. credentials forgotten elsewhere) is where to go next.
    setStep(next ?? resumeStep(latest.current.completed, false))
  }

  // Back to mapping needs the upload held in memory; after a reload (quality resumed from the server) it is gone.
  const prev = previousStep(step)
  const backTarget = prev === 'mapping' && !draft.upload ? 'data' : prev
  const back = backTarget ? (
    <Button variant="ghost" onClick={() => setStep(backTarget)}>
      {t('common:actions.back')}
    </Button>
  ) : undefined

  const props: StepProps = { mode: 'initial', state, onStateChange, back, onDone }

  return (
    <>
      <Header title={t('dialog.initialTitle')} description={t('dialog.initialDescription')}>
        <Stepper current={step} completed={state.completed} />
      </Header>
      <StepBody step={step} props={props} draft={draft} setDraft={setDraft} onUploaded={onUploaded} />
    </>
  )
}

function StepBody({
  step,
  props,
  draft,
  setDraft,
  onUploaded,
}: {
  step: OnboardingStep
  props: StepProps
  draft: DataDraft
  setDraft: FlowProps['setDraft']
  onUploaded: FlowProps['onUploaded']
}) {
  switch (step) {
    case 'language':
      return <LanguageStep key={step} {...props} />
    case 'llm':
      return <LlmStep key={step} {...props} />
    case 'data':
      return <DataStep key={step} {...props} upload={draft.upload} onUploaded={onUploaded} />
    case 'mapping':
      return <MappingStep key={step} {...props} draft={draft} setDraft={setDraft} />
    case 'quality':
      return <QualityStep key={step} {...props} draft={draft} setDraft={setDraft} />
    case 'telegram':
      return <TelegramStep key={step} {...props} />
  }
}

type SettingsTab = 'language' | 'llm' | 'data' | 'telegram' | 'credentials'
const SETTINGS_TABS: SettingsTab[] = ['language', 'llm', 'data', 'telegram', 'credentials']
type DataStage = 'data' | 'mapping' | 'quality' | 'done'

function SettingsFlow({ state, onStateChange, draft, setDraft, onUploaded }: FlowProps) {
  const { t } = useTranslation('onboarding')
  const [tab, setTab] = useState<SettingsTab>('language')
  const [stage, setStage] = useState<DataStage>('data')
  const base: StepProps = { mode: 'settings', state, onStateChange, onDone: () => {} }

  const backTo = (target: DataStage) => (
    <Button variant="ghost" onClick={() => setStage(target)}>
      {t('common:actions.back')}
    </Button>
  )

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="min-h-0 flex-1 gap-0">
      <Header title={t('dialog.settingsTitle')} description={t('dialog.settingsDescription')}>
        {/* Five tabs just fit 343 px with natural widths; if a longer translation does not, the list scrolls inside itself. */}
        <div className="overflow-x-auto">
          <TabsList className="h-auto w-full md:h-9">
            {SETTINGS_TABS.map((key) => (
              <TabsTrigger key={key} value={key} className="min-h-11 min-w-11 flex-auto px-2 md:min-h-0 md:px-3">
                {t(`settings.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Header>

      <TabsContent value="language" className="flex min-h-0 flex-col">
        <LanguageStep {...base} />
      </TabsContent>
      <TabsContent value="llm" className="flex min-h-0 flex-col">
        <LlmStep {...base} />
      </TabsContent>
      <TabsContent value="data" className="flex min-h-0 flex-col">
        {stage === 'data' && (
          <DataStep {...base} upload={draft.upload} onUploaded={onUploaded} onDone={() => setStage('mapping')} />
        )}
        {stage === 'mapping' && (
          <MappingStep {...base} back={backTo('data')} draft={draft} setDraft={setDraft} onDone={() => setStage('quality')} />
        )}
        {stage === 'quality' && (
          <QualityStep {...base} back={backTo('mapping')} draft={draft} setDraft={setDraft} onDone={() => setStage('done')} />
        )}
        {stage === 'done' && (
          <StepLayout
            title={t('settings.dataDoneTitle')}
            footer={
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(() => EMPTY_DRAFT)
                  setStage('data')
                }}
              >
                {t('settings.uploadAnother')}
              </Button>
            }
          >
            <p role="status" className="flex items-start gap-2 rounded-md bg-positive-soft px-3 py-2 text-sm text-positive">
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('settings.dataDoneBody')}
            </p>
          </StepLayout>
        )}
      </TabsContent>
      <TabsContent value="telegram" className="flex min-h-0 flex-col">
        <TelegramStep {...base} />
      </TabsContent>
      <TabsContent value="credentials" className="flex min-h-0 flex-col">
        <CredentialsStep {...base} />
      </TabsContent>
    </Tabs>
  )
}
