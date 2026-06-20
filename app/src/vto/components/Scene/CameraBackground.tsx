import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CanvasTexture,
  DoubleSide,
  RepeatWrapping,
  SRGBColorSpace,
  type PerspectiveCamera,
} from 'three'
import {
  getCameraFrameCanvas,
  getCameraFrameVersion,
} from '@/vto/lib/cameraFrame'
import { FLIP_Y, MIRROR_X } from '@/vto/lib/faceMath'

/**
 * Renders the camera frame the pose was computed from as a full-frustum plane
 * INSIDE the WebGL scene, so the face pixels and the glasses always come from the
 * same instant (Bug #2 lock). It sits OUTSIDE the mirrored FaceAnchor group and
 * mirrors itself (via the texture, using the same MIRROR_X/FLIP_Y constants) so
 * it matches the glasses and the old CSS-mirrored selfie view. Drawn first
 * (renderOrder −1000, depth test/write off) so the glasses always composite over
 * it. The live `<video>` DOM element stays mounted as the frame source but is
 * now visually covered by this opaque plane.
 */

// Park the plane far behind the face (~−60cm) so glasses always draw on top, but
// well within the camera far plane (10000).
const BG_DISTANCE = 2000

export function CameraBackground() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const lastVersion = useRef(-1)
  // The snapshot canvas starts blank (transparent black). Because the material
  // is opaque (alpha ignored), drawing the plane before any real frame has been
  // captured paints the whole viewport black and hides the live <video> beneath
  // it — which is exactly what happens while detection is still loading, or
  // forever if detection never initialises (e.g. the /mediapipe assets 404).
  // Gate the plane on a real frame having arrived so the live video shows
  // through until then (face visible, no in-scene lock) instead of going black.
  const [hasFrame, setHasFrame] = useState(getCameraFrameVersion() > 0)

  const texture = useMemo(() => {
    const canvas = getCameraFrameCanvas()
    if (!canvas) return null
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    // Mirror via the texture (not a negative mesh scale, which would flip the
    // normal and get backface-culled). Matches the scene-level MIRROR_X/FLIP_Y.
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
    tex.repeat.set(MIRROR_X ? -1 : 1, FLIP_Y ? -1 : 1)
    tex.offset.set(MIRROR_X ? 1 : 0, FLIP_Y ? 1 : 0)
    return tex
  }, [])

  useEffect(() => () => texture?.dispose(), [texture])

  // Re-upload only when a new frame has been drawn into the snapshot canvas,
  // and reveal the plane the first time a real frame arrives.
  useFrame(() => {
    if (!texture) return
    const v = getCameraFrameVersion()
    if (v !== lastVersion.current) {
      texture.needsUpdate = true
      lastVersion.current = v
      if (v > 0 && !hasFrame) setHasFrame(true)
    }
  })

  // No real camera frame yet: render nothing so the live <video> shows through
  // instead of an opaque black plane.
  if (!texture || !hasFrame) return null

  // Size the plane to exactly fill the frustum at BG_DISTANCE.
  const h = 2 * BG_DISTANCE * Math.tan((camera.fov * Math.PI) / 360)
  const w = h * (size.width / size.height)

  return (
    <mesh position={[0, 0, -BG_DISTANCE]} scale={[w, h, 1]} renderOrder={-1000}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        side={DoubleSide}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}
