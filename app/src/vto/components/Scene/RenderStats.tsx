import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { FPS } from '@/vto/lib/fps'
import { useFaceStore } from '@/vto/stores/faceStore'

/**
 * DEV-only: measures the R3F render-loop FPS and publishes it (throttled to ~5Hz
 * to avoid re-render churn) so the HUD can show render-FPS vs detection-FPS — the
 * quickest way to see the Web Worker decoupling at work (render ~60 while
 * detection ~30). Mounted behind `import.meta.env.DEV` in SceneCanvas.
 */
export function RenderStats() {
  const fps = useRef(new FPS())
  const lastWrite = useRef(0)
  useFrame(() => {
    const now = performance.now()
    fps.current.tick(now)
    if (now - lastWrite.current > 200) {
      lastWrite.current = now
      useFaceStore.setState({ renderFps: fps.current.value })
    }
  })
  return null
}
