import { create } from 'zustand'

export type ToastVariant = 'error' | 'info'

/** Optional action button rendered inside a toast (Story 09 AC8: "Reload"). */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  variant: ToastVariant
  message: string
  action?: ToastAction
}

interface UIState {
  theme: 'light'
  toasts: Toast[]
  /** Push a toast; returns its id. */
  pushToast: (
    variant: ToastVariant,
    message: string,
    action?: ToastAction,
  ) => number
  dismissToast: (id: number) => void
}

let nextToastId = 1

export const useUIStore = create<UIState>((set) => ({
  theme: 'light',
  toasts: [],
  pushToast: (variant, message, action) => {
    const id = nextToastId++
    set((s) => ({ toasts: [...s.toasts, { id, variant, message, action }] }))
    return id
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/**
 * Imperative toast helper for non-React call sites (e.g. a WebGL
 * `webglcontextlost` DOM event handler). Mirrors a `toast.error(...)` API.
 */
export const toast = {
  error: (message: string, action?: ToastAction) =>
    useUIStore.getState().pushToast('error', message, action),
  info: (message: string, action?: ToastAction) =>
    useUIStore.getState().pushToast('info', message, action),
}
