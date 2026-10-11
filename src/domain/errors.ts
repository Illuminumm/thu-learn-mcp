export const errorCodes = [
  'AUTH_REQUIRED',
  'SESSION_INVALID',
  'BROWSER_UNAVAILABLE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'NOT_FOUND',
  'INVALID_INPUT',
  'UNSAFE_PATH',
  'FILE_EXISTS',
  'FILE_TOO_LARGE',
  'STORAGE_ERROR',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
const messages: Record<ErrorCode, string> = {
  AUTH_REQUIRED:
    'Authentication is missing or expired. Run pnpm auth login in your own terminal, then retry.',
  SESSION_INVALID: 'Local session cannot be read. Run pnpm auth login in your own terminal.',
  BROWSER_UNAVAILABLE:
    'Could not open the login browser. Run pnpm exec playwright install chromium and retry from a desktop terminal.',
  NETWORK_ERROR: 'The school service could not be reached. Check your network and retry later.',
  TIMEOUT: 'The school request timed out. Retry later.',
  RATE_LIMITED: 'The school service is rate limiting requests. Stop and retry later.',
  UPSTREAM_ERROR: 'The school service returned an unexpected response.',
  NOT_FOUND: 'The requested course, assignment, or file was not found in the selected semester.',
  INVALID_INPUT: 'The supplied parameters or local configuration are invalid.',
  UNSAFE_PATH: 'The download filename, directory, or URL is not allowed.',
  FILE_EXISTS: 'A file with this name already exists. No file was overwritten.',
  FILE_TOO_LARGE: 'The response exceeds the configured size limit.',
  STORAGE_ERROR: 'Local private storage is unavailable. Check directory ownership and permissions.',
  INTERNAL_ERROR: 'The operation failed. No sensitive error details are exposed.',
};
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
  }
}
export function classify(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return new AppError('TIMEOUT');
  return new AppError('INTERNAL_ERROR');
}
export function systemCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
export function isAuthError(error: AppError): boolean {
  return error.code === 'AUTH_REQUIRED' || error.code === 'SESSION_INVALID';
}
