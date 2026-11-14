import { describe, expect, it, vi } from 'vitest';
import type { SaleRecord } from '@datahash/store';
import { DEFAULT_META_API_VERSION, buildMetaEvent, matchSummary, metaSaleProblem, sendMeta, type SendContext } from '../src';

const occurredAt = new Date('2026-10-07T09:30:00Z');
const now = new Date('2026-10-08T00:00:00Z');

const sale = (over: Partial<SaleRecord> = {}): SaleRecord => ({
  source: 'webhook',
  eventId: 'order-1',
  eventName: 'Purchase',
  channel: 'store',
  occurredAt,
  value: 85000,
  currency: 'INR',
  personId: null,
  hashes: { metaPhone: 'mp', metaEmail: 'me' },
  consentAds: true,
  ...over,
});
const ctx = (s: SaleRecord = sale()): SendContext => ({ saleKey: 'k', sale: s, touch: null });
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const meta = { settings: { datasetId: '999' }, token: 'SECRET-TOKEN' };

describe('Meta Purchase', () => {
  it('uses a Graph API version that has not expired', () => {
    // v20.0 expired 24 Sep 2026 and v21.0 expires 21 Jan 2027.
    expect(Number(DEFAULT_META_API_VERSION.replace(/^v/, ''))).toBeGreaterThanOrEqual(26);
  });

  it('sends order_id, value and currency on every Purchase', () => {
    expect(buildMetaEvent(ctx())?.custom_data).toEqual({ value: 85000, currency: 'INR', order_id: 'order-1' });
  });

  it('adds hashed date of birth and gender when known', () => {
    const e = buildMetaEvent(ctx(sale({ hashes: { metaPhone: 'mp', metaDob: 'dob', metaGender: 'g' } })));
    expect(e?.user_data).toMatchObject({ ph: ['mp'], db: ['dob'], ge: ['g'] });
    expect(buildMetaEvent(ctx())?.user_data).not.toHaveProperty('db');
  });

  it('date of birth, gender, name or place alone are not enough to send', () => {
    const e = buildMetaEvent(ctx(sale({ hashes: { metaDob: 'dob', metaGender: 'g', metaFirstName: 'fn', metaCity: 'ct' } })));
    expect(e).toBeNull();
  });

  it('refuses anything that is not a proper Purchase, before calling Meta', async () => {
    expect(metaSaleProblem(sale(), now)).toBeNull();
    expect(metaSaleProblem(sale({ eventName: 'Lead' }), now)).toMatch(/^unsupported_event/);
    expect(metaSaleProblem(sale({ value: undefined }), now)).toMatch(/^missing_value/);
    expect(metaSaleProblem(sale({ value: -1 }), now)).toMatch(/^missing_value/);
    expect(metaSaleProblem(sale({ currency: undefined }), now)).toMatch(/^missing_currency/);
    expect(metaSaleProblem(sale({ currency: 'rupees' }), now)).toMatch(/^missing_currency/);
    expect(metaSaleProblem(sale({ occurredAt: new Date(now.getTime() + 10 * 60_000) }), now)).toMatch(/^event_time_in_future/);
    expect(metaSaleProblem(sale({ occurredAt: new Date(now.getTime() + 60_000) }), now)).toBeNull(); // small clock difference is fine

    const fetchImpl = vi.fn();
    const res = await sendMeta(ctx(sale({ eventName: 'Lead' })), meta, { fetchImpl: fetchImpl as never, now: () => now });
    expect(res).toMatchObject({ outcome: 'failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never puts the access token in the URL', async () => {
    const fetchImpl = vi.fn(async () => json({ events_received: 1 }));
    await sendMeta(ctx(), meta, { fetchImpl: fetchImpl as never, now: () => now });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('SECRET-TOKEN');
    expect(init.body as string).not.toContain('SECRET-TOKEN');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer SECRET-TOKEN');
  });

  it("keeps Meta's plain explanation of a refusal", async () => {
    const error = { code: 100, error_subcode: 2804003, message: 'Invalid parameter', error_user_title: 'Event too old', error_user_msg: 'event_time is too far in the past' };
    const res = await sendMeta(ctx(), meta, { fetchImpl: (async () => json({ error }, 400)) as never, now: () => now });
    expect(res).toEqual({
      outcome: 'failed',
      error: 'meta 400 code 100/2804003: Invalid parameter (Event too old: event_time is too far in the past)',
    });
  });

  it('the admin preview lists state, date of birth and gender', () => {
    const m = matchSummary('meta', ctx(sale({ hashes: { metaPhone: 'mp', metaState: 'st', metaDob: 'dob' } })));
    expect(m.used).toEqual(expect.arrayContaining(['phone', 'state', 'date of birth']));
    expect(m.missing).toContain('gender');
  });
});
