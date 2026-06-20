/**
 * App footer (Story 10 AC8). One line, 12px muted: copyright, the
 * attribution-modal trigger, and a GitHub link (placeholder href). `py-6` (24px)
 * vertical padding so it sits 24px below the viewport content. Per
 * DESIGN-PRINCIPLES: muted 12px, links use the shared underline-on-hover /
 * focus-visible pattern. No decoration.
 *
 * The attribution link is a button (it opens an in-app modal, not a URL); the
 * GitHub link is a real anchor to a placeholder repo until Story 11 fills it in.
 */

/** Placeholder until the real repository URL is wired in at deploy (Story 11). */
const GITHUB_URL = 'https://github.com'

const linkClass =
  'underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline ' +
  'focus-visible:underline focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-sm'

export function Footer({ onOpenAttribution }: { onOpenAttribution: () => void }) {
  const year = new Date().getFullYear()

  return (
    <footer className="flex w-full flex-wrap items-center justify-center gap-2 py-6 text-xs text-muted">
      <span>© {year} Virtual Try-On</span>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onOpenAttribution} className={linkClass}>
        Model attributions
      </button>
      <span aria-hidden="true">·</span>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        GitHub
      </a>
    </footer>
  )
}
