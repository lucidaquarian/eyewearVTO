import { Environment } from '@react-three/drei'

// Self-hosted HDR — fetched at build time by scripts/fetch-mediapipe-assets.mjs.
// `preset="city"` downloads from raw.githack.com at runtime, which violates
// connect-src 'self'. Using `files` with a local path keeps everything same-origin.
const HDRI_PATH = '/hdri/potsdamer_platz_1k.hdr'

export function Lights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <Environment files={HDRI_PATH} background={false} />
    </>
  )
}
