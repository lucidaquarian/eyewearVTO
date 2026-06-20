import { Component } from 'react'
import type { ReactNode } from 'react'
import { logger } from '@/vto/lib/logger'

/**
 * Catches a failed `useGLTF` load (Story 09 AC10) and renders a fallback subtree
 * (the placeholder GLB) instead of letting the error blank out the scene. Logs
 * the failure via `logger`.
 *
 * `resetKey` lets the boundary recover when the selected model changes: a new
 * key remounts the boundary so a previously-failed URL doesn't keep showing the
 * fallback after the user picks a different (working) frame.
 */
interface Props {
  children: ReactNode
  fallback: ReactNode
  resetKey: string
  /** For logging context (which URL failed). */
  url: string
}

interface State {
  hasError: boolean
}

export class GLBErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    logger.error('GLB failed to load, falling back to placeholder', this.props.url, error)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
