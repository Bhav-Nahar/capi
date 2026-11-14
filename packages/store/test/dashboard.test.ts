import { describe, expect, it } from 'vitest';
import { dayIn, platformState, summarizeDashboard, type DashboardRow } from '../src/dashboard';

const since = new Date('2026-11-10T00:00:00+05:30');
const until = new Date('2026-11-13T18:00:00+05:30');

const row = (key: string, at: string, value: number, deliveries: DashboardRow['deliveries'], storeName = 'Pune'): DashboardRow => ({
  saleKey: key,
  sale: { source: 'webhook', eventId: key, eventName: 'Purchase', channel: 'store', occurredAt: new Date(at), value, currency: 'INR', storeName, personId: null, hashes: {}, consentAds: true },
  deliveries,
});
const meta = (status: 'sent' | 'failed' | 'pending' | 'skipped', touchId?: string) => ({ destination: 'meta' as const, status, ...(touchId ? { touchId } : {}) });
const google = (status: 'sent' | 'failed' | 'pending' | 'skipped', processingStatus?: 'success' | 'processing' | 'rejected', touchId?: string) => ({
  destination: 'google_ads' as const, status, ...(processingStatus ? { processingStatus } : {}), ...(touchId ? { touchId } : {}),
});

describe('platform state', () => {
  it('Meta is accepted when sent; Google only once it has processed the sale', () => {
    expect(platformState(meta('sent'))).toBe('accepted');
    expect(platformState(google('sent'))).toBe('confirming');
    expect(platformState(google('sent', 'processing'))).toBe('confirming');
    expect(platformState(google('sent', 'success'))).toBe('accepted');
    expect(platformState(google('sent', 'rejected'))).toBe('rejected');
    expect(platformState(meta('failed'))).toBe('rejected');
    expect(platformState(meta('pending'))).toBe('waiting');
    expect(platformState(meta('skipped'))).toBe('skipped');
  });
});

describe('dashboard', () => {
  const rows = [
    row('A', '2026-11-13T11:00:00+05:30', 85000, [meta('sent', 't1'), google('sent', 'success', 't2')]),
    row('B', '2026-11-12T15:00:00+05:30', 40000, [meta('sent'), google('sent', 'processing')], 'Mumbai'),
    row('C', '2026-11-12T10:00:00+05:30', 20000, [meta('failed'), google('sent', 'rejected')]),
    row('D', '2026-11-10T12:00:00+05:30', 10000, [{ ...meta('skipped'), skipReason: 'no_consent' }, { ...google('skipped'), skipReason: 'no_consent' }]),
    row('OLD', '2026-11-01T12:00:00+05:30', 99999, [meta('sent')]), // before the window: left out everywhere
  ];
  const d = summarizeDashboard(rows, { since, until });

  it('totals cover only the chosen days', () => {
    expect(d.totals).toEqual({ sales: 4, revenue: 155000, matchedToClick: 1, accepted: 2, revenueAccepted: 125000 });
    expect(d.currency).toBe('INR');
  });

  it('the funnel narrows: received, sent, accepted', () => {
    expect(d.funnel.map((f) => [f.key, f.count])).toEqual([['received', 4], ['sent', 3], ['accepted', 2]]);
  });

  it('each platform: states, accepted value, and the accept rate of what got a final answer', () => {
    expect(d.platforms.meta).toEqual({ accepted: 2, confirming: 0, waiting: 0, rejected: 1, skipped: 1, revenueAccepted: 125000, acceptRate: 2 / 3 });
    expect(d.platforms.google_ads).toMatchObject({ accepted: 1, confirming: 1, rejected: 1, skipped: 1, revenueAccepted: 85000, acceptRate: 0.5 });
    expect(d.skipReasons).toEqual({ no_consent: 2 });
  });

  it('one entry per calendar day in India time, empty days included', () => {
    expect(d.daily.map((x) => x.date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(d.daily[1]).toEqual({ date: '2026-11-11', sales: 0, revenue: 0, revenueAccepted: 0 });
    expect(d.daily[2]).toEqual({ date: '2026-11-12', sales: 2, revenue: 60000, revenueAccepted: 40000 });
    expect(dayIn(new Date('2026-11-12T20:00:00Z'), 330)).toBe('2026-11-13'); // 01:30 next day in India
  });

  it('stores by revenue, and the newest sales first', () => {
    expect(d.stores[0]).toEqual({ name: 'Pune', sales: 3, revenue: 115000 });
    expect(d.recent.map((r) => r.eventId)).toEqual(['A', 'B', 'C', 'D']);
    expect(d.recent[0]).toMatchObject({ matchedToClick: true, platforms: { meta: 'accepted', google_ads: 'accepted' } });
  });

  it('credits each sale to Google, Meta or direct under each model', () => {
    const g = new Date('2026-11-01T12:00:00Z').getTime();
    const m = new Date('2026-11-08T12:00:00Z').getTime();
    const withClicks = [
      { ...row('G-then-M', '2026-11-12T12:00:00+05:30', 100000, [meta('sent')]), sale: { ...row('x', '2026-11-12T12:00:00+05:30', 100000, []).sale, eventId: 'G-then-M', adClicks: [{ at: g, platform: 'google' as const }, { at: m, platform: 'meta' as const }] } },
      row('none', '2026-11-12T13:00:00+05:30', 50000, [meta('sent')]),
    ];
    const a = summarizeDashboard(withClicks, { since, until }).attribution;
    expect(a.first_click.google).toEqual({ sales: 1, revenue: 100000 });
    expect(a.last_click.meta).toEqual({ sales: 1, revenue: 100000 });
    expect(a.linear.google).toEqual({ sales: 0.5, revenue: 50000 });
    expect(a.linear.direct).toEqual({ sales: 1, revenue: 50000 });
    expect(a.position_based.meta).toEqual({ sales: 0.5, revenue: 50000 });
    expect(a.time_decay.meta.sales).toBeGreaterThan(0.5); // the Meta click is more recent
  });

  it('an empty brand gives zeros and no accept rate, not errors', () => {
    const e = summarizeDashboard([], { since, until });
    expect(e.totals.sales).toBe(0);
    expect(e.platforms).toEqual({});
    expect(e.daily).toHaveLength(4);
  });
});
