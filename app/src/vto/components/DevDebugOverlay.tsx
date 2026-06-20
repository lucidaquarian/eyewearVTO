import { useFaceStore } from '@/vto/stores/faceStore'
import { useShallow } from 'zustand/react/shallow'

/**
 * Dev-only corner HUD: rolling FPS + face-detected state.
 *
 * Guarded by `import.meta.env.DEV` so Vite tree-shakes it out of production
 * builds entirely (the whole component returns null and the dead branch is
 * dropped). Not an interactive element; purely diagnostic.
 */
export function DevDebugOverlay() {
  if (!import.meta.env.DEV) return null
  return <DevDebugOverlayInner />
}

function DevDebugOverlayInner() {
  const { fps, renderFps, detectMs, delegate, hasFace, status } = useFaceStore(
    useShallow((s) => ({
      fps: s.fps,
      renderFps: s.renderFps,
      detectMs: s.detectMs,
      delegate: s.delegate,
      hasFace: s.faceLandmarks !== null,
      status: s.status,
    })),
  )

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-2 top-2 z-10 select-none rounded-md bg-ink px-2 py-1 font-mono text-xs leading-tight text-bg opacity-90"
    >
      <div>{Math.round(renderFps)} fps render</div>
      <div className="opacity-70">
        {Math.round(fps)} fps detect · {detectMs.toFixed(1)} ms
        {delegate ? ` · ${delegate.toUpperCase()}` : ''}
      </div>
      <div>{hasFace ? 'Face detected' : 'No face'}</div>
      <div className="opacity-70">{status}</div>
    </div>
  )
}
