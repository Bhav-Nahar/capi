import { describe, expect, it, vi } from 'vitest';
import type { Touch } from '@datahash/core';
import type { SaleRecord } from '@datahash/store';
import { buildGoogleEvent, buildGoogleRequest, sendGoogle, type SendContext } from '../src';

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
  hashes: { googlePhone: 'gp', googleEmail: 'ge' },
  consentAds: true,
  ...over,
});
const touch = (over: Partial<Touch> = {}): Touch => ({ id: 't1', clickedAt: new Date('2026-09-30T10:00:00Z'), ...over });
const ctx = (s: SaleRecord = sale(), t: Touch | null = null): SendContext => ({ saleKey: 'k', sale: s, touch: t });
const settings = { customerId: '1234567890', conversionActionId: '77' };

describe('Google Purchase', () => {
  it('always carries the value, currency, transaction ID and where the sale happened', () => {
    expect(buildGoogleEvent(ctx())).toMatchObject({
      transactionId: 'order-1',
      eventTimestamp: occurredAt.toISOString(),
      eventSource: 'IN_STORE',
      conversionValue: 85000,
      currency: 'INR',
    });
  });

  it('sends the click ID (OCL) and the hashed email and phone (ECL) together', () => {
    const e = buildGoogleEvent(ctx(sale(), touch({ gclid: 'G1' })));
    expect(e?.adIdentifiers).toEqual({ gclid: 'G1' });
    expect(e?.userData?.userIdentifiers).toEqual([{ emailAddress: 'ge' }, { phoneNumber: 'gp' }]);
  });

  it('without a click, still sends on hashed email and phone (ECL only)', () => {
    const e = buildGoogleEvent(ctx());
    expect(e?.adIdentifiers).toBeUndefined();
    expect(e?.userData?.userIdentifiers).toHaveLength(2);
  });

  it('marks the identifiers as hex and states consent when the customer agreed', () => {
    const r = buildGoogleRequest(ctx(), settings);
    expect(r).toMatchObject({ encoding: 'HEX', consent: { adUserData: 'CONSENT_GRANTED' }, validateOnly: false });
    expect(r?.destinations[0]).toMatchObject({ productDestinationId: '77', operatingAccount: { accountId: '1234567890' } });
  });

  it('refuses anything that is not a proper Purchase, before calling Google', async () => {
    const fetchImpl = vi.fn();
    const run = (s: SaleRecord) => sendGoogle(ctx(s), { settings, refreshToken: 'RT' }, { clientId: 'c', clientSecret: 's' }, { fetchImpl: fetchImpl as never, now: () => now.getTime() });

    expect(await run(sale({ eventName: 'Lead' }))).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/^unsupported_event/) });
    expect(await run(sale({ value: undefined }))).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/^missing_value/) });
    expect(await run(sale({ currency: undefined }))).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/^missing_currency/) });
    expect(await run(sale({ occurredAt: new Date(now.getTime() + 3_600_000) }))).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/^event_time_in_future/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
