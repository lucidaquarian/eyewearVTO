import { useEffect, useMemo, useState } from 'react'
import { useUIStore } from '@/vto/stores/uiStore'
import { useCatalogStore } from '@/vto/stores/catalogStore'
import { ViewportFrame } from '@/vto/components/ViewportFrame'
import { FrameSwitcher } from '@/vto/components/FrameSwitcher/FrameSwitcher'
import { TintSwitcher } from '@/vto/components/FrameSwitcher/TintSwitcher'
import { AttributionModal } from '@/vto/components/AttributionModal'
import { PDPanel } from '@/vto/components/PDPanel'
import { CaptureButton } from '@/vto/components/CaptureButton'
import { Header } from '@/vto/components/Header'
import { Footer } from '@/vto/components/Footer'
import { checkSupport } from '@/vto/lib/browserSupport'
import { BrowserUnsupported } from '@/vto/components/states/BrowserUnsupported'

function App() {
  // Subscribe to theme — used by future stories for conditional styling
  const theme = useUIStore((s) => s.theme)
  const [attributionOpen, setAttributionOpen] = useState(false)
  const [pdOpen, setPdOpen] = useState(false)

  // Load persisted user uploads (IndexedDB) once; restores a custom selection.
  const loadCustomFrames = useCatalogStore((s) => s.loadCustomFrames)
  useEffect(() => {
    void loadCustomFrames()
  }, [loadCustomFrames])

  // Story 09 AC7: gate the whole app on browser capability. Evaluated once.
  // Highest priority in the state precedence (Unsupported > camera > face > light).
  const support = useMemo(() => checkSupport(), [])
  if (!support.ok) return <BrowserUnsupported missing={support.missing} />

  return (
    <div
      className="flex min-h-screen flex-col bg-bg"
      data-theme={theme}
    >
      {/* Minimal wordmark header, top-left (Story 10 AC7). */}
      <Header />

      {/* Main content region — viewport + actions + frame rail, centered in the
          space between the header and footer. */}
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <ViewportFrame />

        {/* Action row below the viewport, centered (DESIGN: actions sit below the
            frame). Story 07 Capture button + Story 08 Measure PD button. */}
        <div className="flex items-center justify-center gap-4">
          <CaptureButton />
          <button
            type="button"
            onClick={() => setPdOpen(true)}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Measure PD
          </button>
        </div>

        {/* Right rail: the product thumbnail + lens-tint swatches. Stacked
            horizontal scrollers here (<1024px); a fixed vertical rail on the
            right edge, vertically centred, at ≥1024px. */}
        <aside
          aria-label="Glasses options"
          className="flex w-full flex-col items-center gap-3 lg:fixed lg:right-8 lg:top-1/2 lg:max-h-[calc(100vh-128px)] lg:w-24 lg:-translate-y-1/2 lg:items-stretch lg:overflow-y-auto"
        >
          <FrameSwitcher />
          <TintSwitcher />
        </aside>
      </main>

      {/* Footer: copyright + attribution-modal trigger + GitHub link
          (Story 10 AC8). 24px below the viewport content via py-6. */}
      <Footer onOpenAttribution={() => setAttributionOpen(true)} />

      <AttributionModal
        open={attributionOpen}
        onClose={() => setAttributionOpen(false)}
      />

      {/* Story 08 — PD measurement. Slide-in (≥1024px) / bottom sheet (<1024px).
          Closing discards any in-progress measurement (AC10). */}
      <PDPanel open={pdOpen} onClose={() => setPdOpen(false)} />
    </div>
  )
}

export default App
