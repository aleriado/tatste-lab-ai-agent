export function logInfo(message: string, meta?: unknown) {
  // Simple structured logging for now
  if (meta) {
    // eslint-disable-next-line no-console
    console.log(`[info] ${message}`, meta);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[info] ${message}`);
  }
}

export function logError(message: string, meta?: unknown) {
  if (meta) {
    // eslint-disable-next-line no-console
    console.error(`[error] ${message}`, meta);
  } else {
    // eslint-disable-next-line no-console
    console.error(`[error] ${message}`);
  }
}

