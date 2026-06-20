/**
 * A tiny module-level ref holding the live R3F WebGL `<canvas>` DOM node.
 *
 * Story 07 (photo capture) needs a handle on the actual GL canvas to composite
 * it with the video frame. Rather than thread a React ref down through R3F's
 * `<Canvas>` (which renders its own internal `<canvas>`), SceneCanvas's existing
 * `onCreated` handler publishes `gl.domElement` here and clears it on context
 * loss / unmount. `compositeFrame` reads it imperatively. This keeps the access
 * framework-light and does not touch the context-loss handler.
 */
let canvasEl: HTMLCanvasElement | null = null

export function setWebglCanvas(el: HTMLCanvasElement | null): void {
  canvasEl = el
}

export function getWebglCanvas(): HTMLCanvasElement | null {
  return canvasEl
}
