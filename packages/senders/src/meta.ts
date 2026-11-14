import { buildFbc, type Channel } from '@datahash/core';
import type { MetaSettings } from '@datahash/store';
import { purchaseProblem, timedFetch, type HttpOptions, type SendContext, type SendResult } from './types';

/**
 * Graph API version. v26.0 (released 29 Jul 2026) had no expiry date announced when this was set in Nov 2026; v20.0
 * expired on 24 Sep 2026 and v21.0 expires on 21 Jan 2027. Check https://developers.facebook.com/docs/graph-api/changelog/versions/
 * before each upgrade. Override with `apiVersion` (META_API_VERSION on the server).
 */
export const DEFAULT_META_API_VERSION = 'v26.0';


/** Meta action_source by channel. VERIFY the allowed values and rules for each in Meta's docs. */
const ACTION_SOURCE: Record<Channel, string> = {
  store: 'physical_store',
  whatsapp: 'business_messaging',
  online: 'system_generated',
  web_lead: 'system_generated',
};

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  messaging_channel?: string;
  user_data: {
    ph?: string[];
    em?: string[];
    fn?: string[];
    ln?: string[];
    ct?: string[];
    st?: string[];
    zp?: string[];
    country?: string[];
    external_id?: string[];
    db?: string[];
    ge?: string[];
    fbc?: string;
    fbp?: string;
    ctwa_clid?: string;
  };
  custom_data: { value: number; currency: string; order_id: string };
}

/** Why this sale cannot be sent to Meta as it is, or null if it can (the shared Purchase rules). */
export const metaSaleProblem = purchaseProblem;

export function buildMetaEvent({ sale, touch }: SendContext): MetaEvent | null {
  if (sale.value === undefined || !sale.currency) return null;
  const user_data: MetaEvent['user_data'] = {};
  if (sale.hashes.metaPhone) user_data.ph = [sale.hashes.metaPhone];
  if (sale.hashes.metaEmail) user_data.em = [sale.hashes.metaEmail];
  // Customer details that raise the match rate. Lists, like the Business SDK sends them; fbp is a plain string.
  const h = sale.hashes;
  if (h.metaFirstName) user_data.fn = [h.metaFirstName];
  if (h.metaLastName) user_data.ln = [h.metaLastName];
  if (h.metaCity) user_data.ct = [h.metaCity];
  if (h.metaState) user_data.st = [h.metaState];
  if (h.metaZip) user_data.zp = [h.metaZip];
  if (h.metaCountry) user_data.country = [h.metaCountry];
  if (h.metaExternalId) user_data.external_id = [h.metaExternalId];
  if (h.metaDob) user_data.db = [h.metaDob];
  if (h.metaGender) user_data.ge = [h.metaGender];
  if (h.fbp) user_data.fbp = h.fbp;
  if (touch?.fbc) user_data.fbc = touch.fbc;
  else if (touch?.fbclid) user_data.fbc = buildFbc(touch.fbclid, touch.clickedAt.getTime());
  if (touch?.ctwaClid) user_data.ctwa_clid = touch.ctwaClid;
  // Meta needs a real identifier. Name, place and the browser ID only help a match; they are not one on their own.
  if (!user_data.ph && !user_data.em && !user_data.fbc && !user_data.ctwa_clid) return null;

  const event: MetaEvent = {
    event_name: sale.eventName,
    event_time: Math.floor(sale.occurredAt.getTime() / 1000),
    // Same ID on every retry (and on any pixel event for the same action) so Meta counts the sale once.
    event_id: sale.eventId,
    action_source: ACTION_SOURCE[sale.channel],
    user_data,
    // order_id: the receipt / order number. Meta uses it to remove duplicates and shows it in reporting.
    custom_data: { value: sale.value, currency: sale.currency, order_id: sale.eventId },
  };
  if (sale.channel === 'whatsapp') event.messaging_channel = 'whatsapp';
  return event;
}

interface MetaError {
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
}

// Meta error codes that mean "slow down / try later". VERIFY against Meta's current error reference.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const AUTH_CODES = new Set([102, 190]);

export async function sendMeta(
  ctx: SendContext,
  connection: { settings: MetaSettings; token: string },
  opts: HttpOptions & { apiVersion?: string; now?: () => Date } = {},
): Promise<SendResult> {
  const problem = metaSaleProblem(ctx.sale, opts.now ? opts.now() : new Date());
  if (problem) return { outcome: 'failed', error: problem };
  const event = buildMetaEvent(ctx);
  if (!event) return { outcome: 'failed', error: 'no_user_data: no hashed phone, email or click ID to match on' };

  // The token goes in the Authorization header, never in the URL, so it cannot end up in request logs.
  const url = `https://graph.facebook.com/${opts.apiVersion ?? DEFAULT_META_API_VERSION}/${connection.settings.datasetId}/events`;
  const body = {
    data: [event],
    ...(connection.settings.testEventCode ? { test_event_code: connection.settings.testEventCode } : {}),
  };

  let res: Response;
  try {
    res = await timedFetch(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${connection.token}` }, body: JSON.stringify(body) },
      opts,
    );
  } catch (err) {
    return { outcome: 'retry', error: `network: ${err instanceof Error ? err.message : 'error'}` };
  }

  // A reply we cannot read is not proof Meta received the event. Retry with the same event ID (safe: Meta dedupes).
  const json = (await res.json().catch(() => null)) as { events_received?: number; fbtrace_id?: string; error?: MetaError } | null;
  if (res.ok) {
    if (!json) return { outcome: 'retry', error: 'meta: unreadable response, will check again' };
    if (!json.events_received) return { outcome: 'failed', error: 'meta accepted the request but received 0 events' };
    // Persist the mode from the body actually submitted, not from a later connection preview.
    // The delivery response contains no access token or customer identifiers.
    return { outcome: 'sent', response: `events_received=${json.events_received}${json.fbtrace_id ? ` trace=${json.fbtrace_id}` : ''} dataset_id=${connection.settings.datasetId} test_event_code=${body.test_event_code ?? 'none'}` };
  }

  const e = json?.error ?? {};
  // error_user_msg is Meta's plain explanation (e.g. which parameter is wrong); keep it next to the technical message.
  const userMsg = [e.error_user_title, e.error_user_msg].filter(Boolean).join(': ');
  const message = `meta ${res.status}${e.code ? ` code ${e.code}` : ''}${e.error_subcode ? `/${e.error_subcode}` : ''}: ${e.message ?? 'error'}${userMsg ? ` (${userMsg})` : ''}`;
  if (e.code !== undefined && AUTH_CODES.has(e.code)) return { outcome: 'failed', error: message, authError: true };
  if (res.status >= 500 || res.status === 429 || e.is_transient || (e.code !== undefined && TRANSIENT_CODES.has(e.code))) {
    return { outcome: 'retry', error: message };
  }
  return { outcome: 'failed', error: message };
}
