/**
 * True only when the `?debug=1` URL flag is present AND this is a dev build.
 *
 * Guarding on `import.meta.env.DEV` lets the bundler statically fold this to
 * `false` in production, so any subtree gated on it (e.g. `<LandmarkDebug/>`)
 * is dropped from the production bundle (Story 05 AC8 — "Removed in production").
 */
export function isDebug(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('debug')
}
