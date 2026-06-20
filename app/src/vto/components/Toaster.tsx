import { useUIStore } from '@/vto/stores/uiStore'
import { useShallow } from 'zustand/react/shallow'

/**
 * Renders the stack of active toasts, bottom-centre of the viewport. Each toast
 * is an `aria-live` polite region so screen readers announce it. Error toasts
 * (e.g. WebGL context loss → "Refresh to recover") are dismissible.
 *
 * Toasts are pushed via `toast.error(...)` / `useUIStore.pushToast(...)`.
 */
export function Toaster() {
  const toasts = useUIStore(useShallow((s) => s.toasts))
  const dismissToast = useUIStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.variant === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-[480px] items-center gap-3 rounded-md border px-4 py-2 text-sm ${
            t.variant === 'error'
              ? 'border-error bg-surface text-error'
              : 'border-border bg-surface text-ink'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={t.action.onClick}
              className="rounded font-medium underline transition-colors duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="rounded text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
