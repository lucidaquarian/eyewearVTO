type Level = 'debug' | 'info' | 'warn' | 'error'

const enabled: Record<Level, boolean> = {
  debug: import.meta.env.DEV,
  info: import.meta.env.DEV,
  warn: true,
  error: true,
}

export const logger = {
  debug: (...a: unknown[]) => enabled.debug && console.debug('[vto]', ...a),
  info:  (...a: unknown[]) => enabled.info  && console.info('[vto]', ...a),
  warn:  (...a: unknown[]) => enabled.warn  && console.warn('[vto]', ...a),
  error: (...a: unknown[]) => enabled.error && console.error('[vto]', ...a),
}
