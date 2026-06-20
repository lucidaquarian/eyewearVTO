/**
 * Minimal app header (Story 10 AC7). Top-left wordmark only — "Virtual Try-On"
 * in 16px semibold ink. No logo, no navigation, 48px tall. Per DESIGN-PRINCIPLES
 * the app is "not a marketing page" and "not branded": this is a plain wordmark,
 * nothing else.
 */
export function Header() {
  return (
    <header className="flex h-12 w-full items-center px-4">
      <span className="text-base font-semibold text-ink">Virtual Try-On</span>
    </header>
  )
}
