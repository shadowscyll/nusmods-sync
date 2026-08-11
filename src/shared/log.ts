const PREFIX = '[NUSMods Sync]';

export function debugLog(message: string, ...details: unknown[]): void {
  if (import.meta.env.DEV) console.debug(PREFIX, message, ...details);
}

export function errorLog(message: string, error?: unknown): void {
  console.error(PREFIX, message, error);
}
