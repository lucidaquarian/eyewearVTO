/**
 * Platform heuristics for choosing the face-detection execution path.
 */

/**
 * True for WebKit-backed browsers: desktop Safari plus every iOS/iPadOS browser
 * (all of which are WebKit under the hood, regardless of branding — iOS "Chrome"
 * is CriOS/WebKit, iOS "Firefox" is FxiOS/WebKit, etc.).
 *
 * WHY THIS MATTERS
 * ----------------
 * MediaPipe's GPU delegate needs a WebGL2 context. In our face-detection Web
 * Worker (lib/faceWorkerClient) that context can only come from OffscreenCanvas,
 * which WebKit either lacks or implements unreliably for WebGL. So on Safari the
 * worker's GPU delegate init throws and detection silently falls back to the
 * ~80-250ms/frame CPU (XNNPACK) delegate — the glasses then visibly trail the
 * face. The SAME MediaPipe build gets a real GPU delegate on the MAIN thread,
 * where WebKit's WebGL2 is fully supported. FaceTrackerBridge therefore routes
 * WebKit to the main-thread detection path to recover GPU tracking, while
 * Chromium keeps the off-main-thread worker (GPU *and* a free main thread).
 *
 * UA sniffing is used deliberately: the real condition ("does GPU-WebGL2 work
 * inside a worker") can't be feature-detected cheaply up front, and the failure
 * mode of a wrong guess is benign — a misrouted browser still runs detection,
 * just on the other thread.
 */
export function isWebKit(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent

  // iOS/iPadOS — always WebKit. iPadOS ≥13 spoofs a desktop "MacIntel" UA, so
  // also treat a touch-capable "Mac" as iPad.
  const isIOS =
    /iP(?:ad|hone|od)/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  // Desktop Safari — UA contains "Safari/" but none of the Chromium/Firefox
  // tokens (Chromium browsers also append "Safari" to their UA for compat).
  const isDesktopSafari =
    /\bSafari\//.test(ua) &&
    !/\b(?:Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS|Android|SamsungBrowser)\b/.test(
      ua,
    )

  return isIOS || isDesktopSafari
}
