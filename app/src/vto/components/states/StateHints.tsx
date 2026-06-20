import { useEffect, useState } from 'react'
import { useFaceStore } from '@/vto/stores/faceStore'
import { toast } from '@/vto/stores/uiStore'
import { NoFaceHint } from '@/vto/components/states/NoFaceHint'
import { LowLightHint } from '@/vto/components/states/LowLightHint'

/** No-face must hold this long before it counts as "active" (matches AC5). */
const NO_FACE_HINT_MS = 3000
const POLL_MS = 500

/**
 * Coordinates the in-viewport hints and enforces the Story 09 priority rule for
 * the two viewport-level states:
 *
 *   BrowserUnsupported > Camera errors > **No face > Low light**
 *
 * The first two are gated upstream (BrowserUnsupported replaces the whole app in
 * App.tsx; camera errors are shown by PermissionCard while the camera isn't
 * live, during which this component isn't even mounted). Here we resolve the
 * remaining pair explicitly: when the no-face hint is active, the low-light hint
 * is suppressed so the two never show at once.
 *
 * Also surfaces the MediaPipe load-failure toast (AC9) exactly once.
 */
export function StateHints() {
  const faceStatus = useFaceStore((s) => s.status)

  // Is the no-face hint currently "active"? (Higher priority than low light.)
  const [noFaceActive, setNoFaceActive] = useState(false)

  useEffect(() => {
    if (faceStatus !== 'ready') {
      setNoFaceActive(false)
      return
    }
    const tick = () => {
      const { faceLandmarks, lastDetectionAt } = useFaceStore.getState()
      const absentFor = performance.now() - lastDetectionAt
      setNoFaceActive(faceLandmarks === null && absentFor > NO_FACE_HINT_MS)
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [faceStatus])

  // AC9: MediaPipe failed to load → one toast, no retry (refresh is the path).
  useEffect(() => {
    if (faceStatus === 'loadError') {
      toast.error(
        "Couldn't load face tracking. Check your connection and refresh.",
      )
    }
  }, [faceStatus])

  return (
    <>
      <NoFaceHint />
      {/* Low light yields to no-face (priority). */}
      <LowLightHint suppressed={noFaceActive} />
    </>
  )
}
