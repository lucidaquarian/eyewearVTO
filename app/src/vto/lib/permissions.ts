import { logger } from '@/vto/lib/logger'

export type CameraPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported'

/**
 * Query the Permissions API for the current camera permission state.
 *
 * Wrapped in try/catch: Safari (and some Firefox versions) either throw on
 * `{ name: 'camera' }` or don't implement `navigator.permissions` at all.
 * In that case we return 'unsupported' so callers fall back to always
 * showing the permission card.
 */
export async function queryCameraPermission(): Promise<CameraPermissionState> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== 'function'
    ) {
      return 'unsupported'
    }
    // `camera` is not in the standard PermissionName union in all TS lib
    // versions, so cast the descriptor.
    const result = await navigator.permissions.query({
      name: 'camera' as PermissionName,
    })
    return result.state as CameraPermissionState
  } catch (err) {
    logger.debug('permissions.query unsupported, falling back to card', err)
    return 'unsupported'
  }
}
