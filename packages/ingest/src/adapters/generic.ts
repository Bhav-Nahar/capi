import type { Channel } from '@datahash/core';
import type { AdapterResult, IncomingSale } from '../types';
import { asString, hasRealCalendarDay, parseAmount } from '../util';

/** Optional customer details a sender may post, besides phone and email. */
export const DETAIL_KEYS = ['firstName', 'lastName', 'city', 'state', 'postalCode', 'country', 'customerId', 'dateOfBirth', 'gender'] as const;

/** Only Purchase for now. */
export const SUPPORTED_EVENTS = ['Purchase'] as const;

/** A sale dated further ahead than this is a data error (wrong clock or time zone). Meta refuses future events too. */
export const MAX_FUTURE_MS = 5 * 60 * 1000;

const CHANNELS: Channel[] = ['online', 'store', 'whatsapp', 'web_lead'];

/** What is safe to keep in the ingest log for the generic JSON: a fixed allowlist, contact details redacted. */
export function genericLogView(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== 'object') return {};
  const r = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['eventId', 'eventName', 'channel', 'occurredAt', 'value', 'currency', 'store', 'consent']) {
    if (r[key] !== undefined) out[key] = r[key];
  }
  for (const key of ['phone', 'email', ...DETAIL_KEYS]) if (r[key]) out[key] = '[redacted]';
  return out;
}

/**
 * Standard JSON any system can post:
 * { eventId, channel, occurredAt (ISO with time), value, currency?, eventName? ("Purchase"), phone?, email?, store?, consent?,
 *   firstName?, lastName?, city?, state?, postalCode?, country?, customerId?, dateOfBirth? (YYYY-MM-DD), gender? }
 */
export function mapGenericSale(record: unknown, now: Date = new Date()): AdapterResult {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'invalid_payload' };
  const r = record as Record<string, unknown>;

  const eventId = asString(r.eventId);
  if (!eventId) return { ok: false, reason: 'missing_deal_id' };

  const channel = asString(r.channel) as Channel | undefined;
  if (!channel || !CHANNELS.includes(channel)) return { ok: false, reason: 'unknown_channel', detail: channel };

  const at = asString(r.occurredAt);
  const occurredAt = at && /T/.test(at) && hasRealCalendarDay(at) ? new Date(at) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) return { ok: false, reason: 'invalid_date' };
  if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_MS) return { ok: false, reason: 'invalid_date', detail: 'in the future' };

  const eventName = asString(r.eventName) ?? 'Purchase';
  if (!(SUPPORTED_EVENTS as readonly string[]).includes(eventName)) {
    return { ok: false, reason: 'unsupported_event', detail: eventName.slice(0, 40) };
  }

  const sale: IncomingSale = {
    source: 'webhook',
    eventId,
    eventName,
    channel,
    occurredAt,
  };

  if (r.value === undefined || r.value === null || r.value === '') return { ok: false, reason: 'missing_value' };
  const value = parseAmount(r.value);
  if (value === null || value < 0) return { ok: false, reason: 'invalid_amount' };
  sale.value = value;
  const currency = (asString(r.currency) ?? 'INR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, reason: 'invalid_amount', detail: 'currency must be a 3-letter code like INR' };
  sale.currency = currency;
  const store = asString(r.store);
  if (store) sale.storeName = store;
  const phone = asString(r.phone);
  if (phone) sale.phone = phone;
  const email = asString(r.email);
  if (email) sale.email = email;
  for (const key of DETAIL_KEYS) {
    const v = asString(r[key]);
    if (v) sale[key] = v;
  }
  // Consent is a yes or a no. Anything else is refused: guessing "not stated" could let a sale go out under an
  // opt-out policy for a customer who said no.
  if (r.consent !== undefined && r.consent !== null && r.consent !== '') {
    if (typeof r.consent !== 'boolean') return { ok: false, reason: 'invalid_consent', detail: String(r.consent).slice(0, 40) };
    sale.consent = r.consent;
  }

  return { ok: true, sale };
}
