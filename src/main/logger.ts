/**
 * Lightweight structured logger for the main process.
 *
 * Provides log levels and module prefixes without external dependencies.
 * Renderer process should continue using console.log (goes to DevTools).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

let globalLevel: LogLevel = 'info'

/** Set the minimum log level for all loggers */
export function setLogLevel(level: LogLevel): void {
  globalLevel = level
}

/** Get the current global log level */
export function getLogLevel(): LogLevel {
  return globalLevel
}

/**
 * Create a logger with a module prefix.
 *
 * Usage:
 * ```ts
 * const log = createLogger('ws-audio')
 * log.info('Server started on port', port)
 * log.error('Connection failed:', err)
 * ```
 */
export function createLogger(module: string) {
  const prefix = `[${module}]`

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[globalLevel]
  }

  return {
    debug(...args: unknown[]): void {
      if (shouldLog('debug')) console.debug(prefix, ...args)
    },
    info(...args: unknown[]): void {
      if (shouldLog('info')) console.log(prefix, ...args)
    },
    warn(...args: unknown[]): void {
      if (shouldLog('warn')) console.warn(prefix, ...args)
    },
    error(...args: unknown[]): void {
      if (shouldLog('error')) console.error(prefix, ...args)
    }
  }
}

export type Logger = ReturnType<typeof createLogger>
