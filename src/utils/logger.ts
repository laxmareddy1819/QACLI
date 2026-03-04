import createDebug from 'debug';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let globalLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(namespace: string): Logger {
  const dbg = createDebug(`qabot:${namespace}`);

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[globalLevel];
  }

  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog('debug')) dbg(message, ...args);
    },
    info(message: string, ...args: unknown[]) {
      if (shouldLog('info')) dbg(message, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      if (shouldLog('warn')) dbg(`[WARN] ${message}`, ...args);
    },
    error(message: string, ...args: unknown[]) {
      if (shouldLog('error')) dbg(`[ERROR] ${message}`, ...args);
    },
  };
}
