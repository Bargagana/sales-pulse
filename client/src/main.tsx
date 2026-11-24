import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { App } from './App'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing from index.html')

createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
      {/* Top centre: on a phone the bottom edge holds the primary actions, so toasts must not cover them. */}
      <Toaster position="top-center" richColors={false} closeButton />
    </TooltipProvider>
  </StrictMode>,
)
