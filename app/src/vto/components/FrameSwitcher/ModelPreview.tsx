import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGLTF, Bounds } from '@react-three/drei'

function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => scene.clone(true), [scene])
  return <primitive object={clone} />
}

interface ModelPreviewProps {
  modelUrl: string
}

export function ModelPreview({ modelUrl }: ModelPreviewProps) {
  return (
    <Canvas
      frameloop="demand"
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: 40, position: [0, 0, 1] }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={2} />
      <directionalLight position={[2, 3, 2]} intensity={1.5} />
      <directionalLight position={[-1, 1, -2]} intensity={0.4} />
      <Bounds fit clip observe margin={1.2}>
        <Suspense fallback={null}>
          <GlbModel url={modelUrl} />
        </Suspense>
      </Bounds>
    </Canvas>
  )
}
