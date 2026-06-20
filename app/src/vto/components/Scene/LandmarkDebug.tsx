import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { useFaceStore } from '@/vto/stores/faceStore'
import { MIRROR_X } from '@/vto/lib/faceMath'

/**
 * The `<group>` instance type as the JSX runtime sees it (derived from the JSX
 * intrinsic to avoid the dual-`@types/three` nominal mismatch — same trick as
 * FaceAnchor's GroupInstance).
 */
type GroupInstance = NonNullable<
  Extract<JSX.IntrinsicElements['group']['ref'], { current: unknown }>['current']
>

/** The camera type `Vector3.unproject` expects (matches our `three` import). */
type UnprojectCamera = Parameters<Vector3['unproject']>[0]

/**
 * Debug overlay: renders tiny dots at the requested MediaPipe landmark indices
 * (default 168 nose-bridge, 234/454 temples) for visual verification of the
 * anchor (AC8). Gated behind `?debug=1` by the caller (see `lib/debug.ts`) and
 * tree-shaken from production builds (that gate folds to `false` in prod).
 *
 * Landmarks are normalized image coordinates (x,y in 0..1, origin top-left).
 * We unproject them onto a plane in front of the camera so the dots land where
 * the feature is on screen, applying the same mirror as the glasses (MIRROR_X)
 * so left/right agree with AC7.
 */
export function LandmarkDebug({
  indices = [168, 234, 454],
}: {
  indices?: number[]
}) {
  const groupRef = useRef<GroupInstance>(null)

  // One reusable dot vector per requested index.
  const dots = useMemo(() => indices.map(() => new Vector3()), [indices])

  useFrame((state) => {
    const group = groupRef.current
    if (!group) return
    const landmarks = useFaceStore.getState().faceLandmarks
    if (!landmarks) {
      group.visible = false
      return
    }
    group.visible = true
    const camera = state.camera as unknown as UnprojectCamera

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]!
      const lm = landmarks[idx]
      const child = group.children[i]
      if (!lm || !child) continue

      // Normalized image (0..1, top-left) → NDC (-1..1, bottom-left origin).
      let nx = lm.x * 2 - 1
      const ny = -(lm.y * 2 - 1)
      if (MIRROR_X) nx = -nx // match the glasses' source mirror (AC7)

      // Unproject onto a plane in front of the camera.
      const v = dots[i]!
      v.set(nx, ny, 0.5)
      v.unproject(camera)
      // Set component-wise (avoids binding child.position to a specific
      // `@types/three` Vector3 copy).
      child.position.set(v.x, v.y, v.z)
    }
  })

  return (
    <group ref={groupRef}>
      {indices.map((idx) => (
        <mesh key={idx}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshBasicMaterial
            color={idx === 168 ? '#22d3ee' : '#f43f5e'}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}
