/**
 * Capability detection for the browser-unsupported gating screen (Story 09 AC7).
 *
 * Run once on app mount. If anything required is missing we render
 * `<BrowserUnsupported/>` *instead of* the app, so the user gets a clear list of
 * what their browser lacks rather than a half-broken camera/3D experience.
 *
 * The three checks mirror the app's hard runtime requirements:
 *  - `navigator.mediaDevices` — without it there is no camera at all.
 *  - WebGL2 — the R3F/three.js scene needs a WebGL2 context.
 *  - WebAssembly — MediaPipe's face landmarker ships as a WASM module.
 */
export type SupportResult = { ok: true } | { ok: false; missing: string[] }

export function checkSupport(): SupportResult {
  const missing: string[] = []

  if (typeof navigator === 'undefined' || !('mediaDevices' in navigator)) {
    missing.push('Camera access (MediaDevices API)')
  }
  if (typeof window === 'undefined' || !('WebGL2RenderingContext' in window)) {
    missing.push('Modern 3D graphics (WebGL2)')
  }
  if (typeof WebAssembly !== 'object') {
    missing.push('WebAssembly')
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
