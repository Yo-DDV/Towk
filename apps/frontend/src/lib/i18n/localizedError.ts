import { Code, ConnectError } from '@connectrpc/connect';

import * as m from '$lib/i18n/messages';

/**
 * Converts transport and browser failures into product-owned localized copy.
 *
 * The server's raw message is deliberately not exposed: it is commonly written
 * in English, can contain implementation details, and is not a stable public
 * contract. Callers retain their context-specific fallback for unknown errors.
 */
export function localizedErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return m['common.error.cancelled']();
  }
  if (error instanceof TypeError) {
    return m['common.error.network']();
  }
  if (!(error instanceof ConnectError)) return fallback;

  switch (error.code) {
    case Code.Canceled:
      return m['common.error.cancelled']();
    case Code.InvalidArgument:
    case Code.OutOfRange:
      return m['common.error.invalid_request']();
    case Code.DeadlineExceeded:
      return m['common.error.timeout']();
    case Code.NotFound:
      return m['common.error.not_found']();
    case Code.AlreadyExists:
    case Code.Aborted:
      return m['common.error.conflict']();
    case Code.PermissionDenied:
      return m['common.error.permission_denied']();
    case Code.ResourceExhausted:
      return m['common.error.rate_limited']();
    case Code.Unauthenticated:
      return m['common.error.authentication_required']();
    case Code.Unavailable:
      return m['common.error.unavailable']();
    case Code.FailedPrecondition:
    case Code.Unimplemented:
    case Code.Unknown:
    case Code.Internal:
    case Code.DataLoss:
    default:
      return fallback;
  }
}
