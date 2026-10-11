import { ApiError, FailReason } from 'thu-learn-lib';
import { AppError, classify } from '../domain/errors.js';

export function upstreamError(error: unknown): AppError {
  if (
    error instanceof ApiError &&
    [
      FailReason.NO_CREDENTIAL,
      FailReason.NOT_LOGGED_IN,
      FailReason.DOUBLE_AUTH,
      FailReason.CAPTCHA_REQUIRED,
      FailReason.BAD_CREDENTIAL,
    ].includes(error.reason)
  )
    return new AppError('AUTH_REQUIRED');
  const mapped = classify(error);
  return mapped.code === 'INTERNAL_ERROR' ? new AppError('UPSTREAM_ERROR') : mapped;
}
