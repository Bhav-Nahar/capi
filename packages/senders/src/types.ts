import type { Touch } from '@datahash/core';
import type { SaleRecord } from '@datahash/store';

/** Everything a sender needs to build one event. */
export interface SendContext {
  saleKey: string;
  sale: SaleRecord;
  /** The click credited for this sale, if any. */
  touch: Touch | null;
}

/** A sale dated further ahead than this is refused: both platforms reject future events. Allows a little clock drift. */
export const MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Why this sale cannot be sent as a Purchase, or null if it can. Only Purchase is supported for now; Meta requires a
 * value and currency on every Purchase, and a Purchase without a value teaches Google's value bidding nothing.
 * Checked by both senders before anything leaves the server.
 */
export function purchaseProblem(sale: SendContext['sale'], now: Date = new Date()): string | null {
  if (sale.eventName !== 'Purchase') return `unsupported_event: only Purchase is sent (got ${sale.eventName})`;
  if (sale.value === undefined || !Number.isFinite(sale.value) || sale.value < 0) return 'missing_value: a Purchase needs a value';
  if (!sale.currency || !/^[A-Z]{3}$/.test(sale.currency)) return 'missing_currency: a Purchase needs a 3-letter currency code';
  if (sale.occurredAt.getTime() > now.getTime() + MAX_FUTURE_MS) return 'event_time_in_future: the sale is dated in the future';
  return null;
}

export type SendResult =
  /** `requestId` is the platform's ID for an accepted request whose processing result can be looked up later. */
  | { outcome: 'sent'; response: string; requestId?: string }
  /** Temporary problem (rate limit, outage, network): try again later. */
  | { outcome: 'retry'; error: string }
  /** The platform refused it. `authError` means the brand's token or access needs fixing first. */
  | { outcome: 'failed'; error: string; authError?: boolean };

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Fetch with a timeout. Network failures and timeouts are reported as retryable by the senders. */
export async function timedFetch(url: string, init: RequestInit, opts: HttpOptions = {}): Promise<Response> {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
