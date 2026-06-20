/**
 * Gating screen shown *instead of* the app when {@link checkSupport} reports a
 * missing capability (Story 09 AC7). Lists exactly what the browser lacks and
 * suggests an up-to-date desktop browser. Ink-only, sentence case, no CTAs that
 * can't be honoured (there's nothing to retry — the browser itself is the
 * blocker).
 */
export function BrowserUnsupported({ missing }: { missing: string[] }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg p-6">
      <div className="vto-browser-unsupported w-[480px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Your browser is missing what we need
        </h1>
        <p className="mt-2 text-sm text-muted">
          The virtual try-on needs a few modern browser features that aren&apos;t
          available here. The latest desktop Chrome, Edge, Firefox, or Safari will
          work.
        </p>
        <p className="mt-4 text-sm font-medium text-ink">What&apos;s missing</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    </main>
  )
}
