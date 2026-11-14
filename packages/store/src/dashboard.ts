import { ATTRIBUTION_MODELS, attributeSale, type AttributionModel, type AttributionSource, type Destination } from '@datahash/core';
import type { SaleRecord, StoredDelivery } from './sales';

/**
 * What a brand sees on its dashboard: one plain state per sale and platform, rolled up into totals, a daily trend,
 * stores and a recent-activity feed. Pure functions over stored sales, so the numbers are tested without a database.
 */

/** One client-facing state per delivery. */
export type PlatformState =
  /** The platform took it: Meta received the event (shown as "Received"), or Google processed it successfully. */
  | 'accepted'
  /** Sent; Google is still processing it (it reports back within about a day). */
  | 'confirming'
  /** Queued, being sent, or waiting to retry. */
  | 'waiting'
  /** Refused by the platform, or failed for good. */
  | 'rejected'
  /** Never eligible (consent, channel, too old, nothing to match on). */
  | 'skipped';

export function platformState(d: Pick<StoredDelivery, 'status' | 'processingStatus' | 'destination'>): PlatformState {
  if (d.status === 'skipped') return 'skipped';
  if (d.status === 'failed') return 'rejected';
  if (d.status !== 'sent') return 'waiting';
  // Meta answers at once (events_received); Google accepts first and processes later.
  if (d.destination !== 'google_ads') return 'accepted';
  if (d.processingStatus === 'success' || d.processingStatus === 'partial') return 'accepted';
  if (d.processingStatus === 'rejected') return 'rejected';
  return 'confirming';
}

export interface PlatformSummary {
  accepted: number;
  confirming: number;
  waiting: number;
  rejected: number;
  skipped: number;
  /** Value of the sales this platform accepted. */
  revenueAccepted: number;
  /** accepted / (accepted + rejected): of what reached a final answer, the share the platform took. Null before any answer. */
  acceptRate: number | null;
}

export interface DashboardDay {
  /** Calendar day in the brand's time zone, YYYY-MM-DD. */
  date: string;
  sales: number;
  revenue: number;
  /** Value of sales accepted by at least one platform. */
  revenueAccepted: number;
}

export interface DashboardSale {
  saleKey: string;
  eventId: string;
  occurredAt: Date;
  value: number | null;
  currency: string | null;
  storeName: string | null;
  channel: string;
  /** A website ad click was credited to this sale (on any platform). */
  matchedToClick: boolean;
  platforms: Partial<Record<Destination, PlatformState>>;
}

export interface Dashboard {
  since: Date;
  until: Date;
  days: number;
  /** The most common currency; amounts in other currencies are still summed, so a mixed-currency brand should filter. */
  currency: string;
  totals: {
    sales: number;
    revenue: number;
    /** Sales credited to a website ad click on at least one platform. */
    matchedToClick: number;
    /** Sales accepted by at least one platform, and their value. */
    accepted: number;
    revenueAccepted: number;
  };
  /**
   * Received -> sent -> accepted, each step a subset of the one before, counting sales (not deliveries). Matching to
   * an ad click is not a step: a sale without a click is still sent on hashed contact details. See totals.matchedToClick.
   */
  funnel: Array<{ key: 'received' | 'sent' | 'accepted'; label: string; count: number }>;
  platforms: Partial<Record<Destination, PlatformSummary>>;
  daily: DashboardDay[];
  stores: Array<{ name: string; sales: number; revenue: number }>;
  /** Why deliveries were not sent, across platforms. */
  skipReasons: Record<string, number>;
  recent: DashboardSale[];
  /**
   * Which platform gets credit for the sales, under each model. Counts may be fractional (linear splits a sale).
   * Reporting only: covers every sale in the window, sent or not.
   */
  attribution: Record<AttributionModel, Record<AttributionSource, { sales: number; revenue: number }>>;
}

export interface DashboardRow {
  saleKey: string;
  sale: SaleRecord;
  deliveries: Array<Pick<StoredDelivery, 'destination' | 'status' | 'processingStatus' | 'touchId' | 'skipReason'>>;
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of an instant in a fixed UTC offset (minutes). */
export function dayIn(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

const emptyPlatform = (): PlatformSummary => ({ accepted: 0, confirming: 0, waiting: 0, rejected: 0, skipped: 0, revenueAccepted: 0, acceptRate: null });

/**
 * Roll sales up for the dashboard. Sales dated before `since` or after `until` are left out, so the trend and the
 * totals always cover the same days. `offsetMinutes` is the brand's time zone (India: 330).
 */
export function summarizeDashboard(rows: DashboardRow[], opts: { since: Date; until: Date; offsetMinutes?: number; recent?: number; stores?: number }): Dashboard {
  const offset = opts.offsetMinutes ?? 330;
  const inWindow = rows.filter((r) => r.sale.occurredAt >= opts.since && r.sale.occurredAt <= opts.until);

  const firstDay = dayIn(opts.since, offset);
  const lastDay = dayIn(opts.until, offset);
  const daily = new Map<string, DashboardDay>();
  for (let t = Date.parse(`${firstDay}T00:00:00Z`); t <= Date.parse(`${lastDay}T00:00:00Z`); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    daily.set(date, { date, sales: 0, revenue: 0, revenueAccepted: 0 });
  }

  const totals = { sales: 0, revenue: 0, matchedToClick: 0, accepted: 0, revenueAccepted: 0 };
  let sent = 0;
  const platforms: Partial<Record<Destination, PlatformSummary>> = {};
  const stores = new Map<string, { name: string; sales: number; revenue: number }>();
  const currencies = new Map<string, number>();
  const skipReasons: Record<string, number> = {};
  const cell = () => ({ sales: 0, revenue: 0 });
  const credit = () => ({ google: cell(), meta: cell(), direct: cell() });
  const attribution = Object.fromEntries(ATTRIBUTION_MODELS.map((m) => [m, credit()])) as Dashboard['attribution'];

  for (const { sale, deliveries } of inWindow) {
    const value = sale.value ?? 0;
    totals.sales++;
    totals.revenue += value;
    if (sale.currency) currencies.set(sale.currency, (currencies.get(sale.currency) ?? 0) + 1);

    const states = deliveries.map((d) => ({ d, state: platformState(d) }));
    const matched = deliveries.some((d) => d.status !== 'skipped' && Boolean(d.touchId));
    const anyAccepted = states.some((s) => s.state === 'accepted');
    if (matched) totals.matchedToClick++;
    if (states.some((s) => s.state === 'accepted' || s.state === 'confirming' || (s.state === 'rejected' && s.d.status === 'sent'))) sent++;
    if (anyAccepted) {
      totals.accepted++;
      totals.revenueAccepted += value;
    }

    for (const { d, state } of states) {
      const p = (platforms[d.destination] ??= emptyPlatform());
      p[state]++;
      if (state === 'accepted') p.revenueAccepted += value;
      if (state === 'skipped' && d.skipReason) skipReasons[d.skipReason] = (skipReasons[d.skipReason] ?? 0) + 1;
    }

    const shares = attributeSale(sale.adClicks, sale.occurredAt);
    for (const model of ATTRIBUTION_MODELS) {
      for (const src of ['google', 'meta', 'direct'] as const) {
        attribution[model][src].sales += shares[model][src];
        attribution[model][src].revenue += shares[model][src] * value;
      }
    }

    const day = daily.get(dayIn(sale.occurredAt, offset));
    if (day) {
      day.sales++;
      day.revenue += value;
      if (anyAccepted) day.revenueAccepted += value;
    }

    const storeName = sale.storeName?.trim() || 'Not stated';
    const store = stores.get(storeName) ?? { name: storeName, sales: 0, revenue: 0 };
    store.sales++;
    store.revenue += value;
    stores.set(storeName, store);
  }

  for (const p of Object.values(platforms)) {
    const decided = p.accepted + p.rejected;
    p.acceptRate = decided ? p.accepted / decided : null;
  }

  const recent = [...inWindow]
    .sort((a, b) => b.sale.occurredAt.getTime() - a.sale.occurredAt.getTime())
    .slice(0, opts.recent ?? 8)
    .map(({ saleKey, sale, deliveries }): DashboardSale => ({
      saleKey,
      eventId: sale.eventId,
      occurredAt: sale.occurredAt,
      value: sale.value ?? null,
      currency: sale.currency ?? null,
      storeName: sale.storeName ?? null,
      channel: sale.channel,
      matchedToClick: deliveries.some((d) => d.status !== 'skipped' && Boolean(d.touchId)),
      platforms: Object.fromEntries(deliveries.map((d) => [d.destination, platformState(d)])),
    }));

  return {
    since: opts.since,
    until: opts.until,
    days: daily.size,
    currency: [...currencies].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR',
    totals,
    funnel: [
      { key: 'received', label: 'Sales received', count: totals.sales },
      { key: 'sent', label: 'Sent to ad platforms', count: sent },
      { key: 'accepted', label: 'Reached Meta or Google', count: totals.accepted },
    ],
    platforms,
    daily: [...daily.values()],
    stores: [...stores.values()].sort((a, b) => b.revenue - a.revenue).slice(0, opts.stores ?? 6),
    skipReasons,
    recent,
    attribution,
  };
}
