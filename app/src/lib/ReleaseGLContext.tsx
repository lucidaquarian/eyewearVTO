import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * Releases the WebGL context when its <Canvas> unmounts.
 *
 * WHY THIS EXISTS
 * ---------------
 * R3F's <Canvas> disposes scene *resources* on unmount (geometries, materials,
 * textures, render lists, the renderer), but it does NOT free the underlying
 * WebGL *context*. Browsers cap the number of live WebGL contexts per page / GPU
 * process (~16 in Chrome, fewer in Safari/WebKit) and silently drop the OLDEST
 * once the cap is hit.
 *
 * This app mounts and unmounts many canvases over a single session:
 *   - the six collection cards (IntersectionObserver-gated, so scrolling the grid
 *     mounts/unmounts them repeatedly — GlassesCardViewer),
 *   - the hero / product-detail / heritage 360 viewers (Glasses360Viewer),
 *   - the try-on scene on every open/close of the studio (SceneCanvas).
 *
 * Without an explicit release, each unmount LEAKS a context until the cap is
 * reached. Past that point new contexts can no longer be allocated — including
 * the one MediaPipe's GPU delegate needs — so the try-on silently falls back to
 * the ~80-250ms/frame CPU delegate and the glasses visibly trail the face. The
 * leak is cumulative, so tracking degrades the longer the session runs, and a
 * tab reload may not recover a GPU process that is already wedged (which is why
 * a server restart / redeploy changes nothing: none of this is server-side).
 *
 * `forceContextLoss()` reclaims the context slot immediately, capping live
 * contexts at one-per-mounted-canvas instead of growing without bound.
 *
 * USAGE
 * -----
 * Render as a direct child INSIDE <Canvas> so its unmount cleanup runs while the
 * renderer is still alive (a child's effect cleanup fires before the parent
 * <Canvas> tears the root down):
 *
 *   <Canvas>
 *     <ReleaseGLContext />
 *     ...scene...
 *   </Canvas>
 *
 * `onBeforeLoss` runs synchronously right before the context is dropped — used by
 * SceneCanvas to flag the loss as intentional so its `webglcontextlost` handler
 * doesn't show a "Refresh to recover" toast for a normal close.
 */
export function ReleaseGLContext({
  onBeforeLoss,
}: {
  onBeforeLoss?: () => void
}) {
  const gl = useThree((s) => s.gl)

  // Hold the latest callback in a ref so the unmount effect can stay keyed on
  // `gl` alone. Depending on `onBeforeLoss` directly would re-run the effect
  // (and thus fire forceContextLoss) on every render if a caller passes an
  // inline function — which would tear down a live context mid-session.
  const onBeforeLossRef = useRef(onBeforeLoss)
  onBeforeLossRef.current = onBeforeLoss

  useEffect(() => {
    return () => {
      onBeforeLossRef.current?.()
      try {
        gl.dispose()
        gl.forceContextLoss()
      } catch {
        // Best-effort: some browsers throw if the context is already lost.
      }
    }
  }, [gl])

  return null
}
