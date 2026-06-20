import { logger } from '@/vto/lib/logger'

export type CameraErrorCode =
  | 'denied'
  | 'no-device'
  | 'in-use'
  | 'insecure-context'
  | 'unknown'

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 1280, height: 720, facingMode: 'user' },
  audio: false,
}

/**
 * Classify a getUserMedia failure into one of our ErrorCodes.
 * getUserMedia rejects with DOMExceptions whose `name` distinguishes the cause.
 */
export function classifyCameraError(error: unknown): CameraErrorCode {
  // startCamera() throws an Error carrying an explicit `code` for the
  // insecure-context / unsupported-API case (no DOMException is produced there).
  if (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'insecure-context'
  ) {
    return 'insecure-context'
  }
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'denied'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'no-device'
      case 'NotReadableError':
      case 'TrackStartError':
        return 'in-use'
      default:
        return 'unknown'
    }
  }
  return 'unknown'
}

/**
 * Request the camera stream. Throws a CameraErrorCode-shaped error via the
 * thrown value's classification — callers should wrap and classify.
 */
export async function startCamera(): Promise<MediaStream> {
  // Insecure context (no HTTPS) or unsupported API: mediaDevices is absent.
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    const err = new Error('insecure-context') as Error & { code: CameraErrorCode }
    err.code = 'insecure-context'
    throw err
  }

  const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
  return stream
}

/**
 * Stop every track on a MediaStream, releasing the camera hardware.
 */
export function stopCamera(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    track.stop()
  }
  logger.debug('camera tracks stopped', stream.getTracks().length)
}
