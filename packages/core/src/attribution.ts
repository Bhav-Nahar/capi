import type { Touch } from './types';

/**
 * Which ad platform gets credit for a sale. Reporting only: this never changes what is sent to Meta or Google
 * (each platform runs its own attribution on what it receives).
 *
 * At sale time we keep the customer's ad clicks from the window before the sale, oldest first. The dashboard then
 * credits each sale under five common models (every model's shares add up to the whole sale):
 *   first_click    - the first ad click gets the whole sale
 *   last_click     - the last ad click before the sale gets the whole sale
 *   linear         - shared evenly across every ad click
 *   time_decay     - shared, but a click counts half as much for every 7 days it is older than the sale
 *   position_based - first and last click get 40% each, the clicks in between share 20%
 *                    (two clicks: 50/50; one click: all of it)
 * A sale with no ad click in the window is "direct".
 */

/** Google Ads (gclid / gbraid / wbraid) or Meta (fbclid / fbc / WhatsApp ctwa_clid). */
export type AdPlatform = 'google' | 'meta';
export type AttributionSource = AdPlatform | 'direct';
export const ATTRIBUTION_MODELS = ['last_click', 'first_click', 'linear', 'time_decay', 'position_based'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** One ad click: when (milliseconds since 1970) and on which platform. */
export interface AdClick {
  at: number;
  platform: AdPlatform;
}

/** Clicks older than this before the sale do not count (Google's default click-through window). */
export const ATTRIBUTION_WINDOW_DAYS = 30;
/** Time decay: a click's weight halves for every this many days before the sale (the usual 7-day half-life). */
export const TIME_DECAY_HALF_LIFE_DAYS = 7;
/** At most this many clicks are kept per sale: the first one and the most recent ones. */
export const MAX_ATTRIBUTION_CLICKS = 20;

export function touchPlatform(t: Pick<Touch, 'gclid' | 'gbraid' | 'wbraid' | 'fbclid' | 'fbc' | 'ctwaClid'>): AdPlatform | null {
  if (t.gclid || t.gbraid || t.wbraid) return 'google';
  if (t.fbclid || t.fbc || t.ctwaClid) return 'meta';
  return null;
}

/** The customer's ad clicks in the window before the sale, oldest first. Undefined when there are none. */
export function adClicksBefore(touches: Touch[], saleAt: Date, windowDays = ATTRIBUTION_WINDOW_DAYS): AdClick[] | undefined {
  const end = saleAt.getTime();
  const start = end - windowDays * 86_400_000;
  const seen = new Set<string>();
  const clicks: AdClick[] = [];
  for (const t of touches) {
    const at = t.clickedAt.getTime();
    const platform = touchPlatform(t);
    if (!platform || Number.isNaN(at) || at > end || at < start) continue;
    const key = `${platform}|${at}`;
    if (seen.has(key)) continue; // the same click stored twice
    seen.add(key);
    clicks.push({ at, platform });
  }
  if (!clicks.length) return undefined;
  clicks.sort((a, b) => a.at - b.at);
  // Keep the first click (it decides first-click credit) and the most recent ones.
  return clicks.length > MAX_ATTRIBUTION_CLICKS ? [clicks[0]!, ...clicks.slice(-(MAX_ATTRIBUTION_CLICKS - 1))] : clicks;
}

type Shares = Record<AttributionSource, number>;

/** Share of one sale per source under each model. `saleAt` is needed for time decay. */
export function attributeSale(clicks: AdClick[] | undefined, saleAt: Date): Record<AttributionModel, Shares> {
  const zero = (): Shares => ({ google: 0, meta: 0, direct: 0 });
  const result = Object.fromEntries(ATTRIBUTION_MODELS.map((m) => [m, zero()])) as Record<AttributionModel, Shares>;
  // Anything that is not a list of clicks (an older stored shape) counts as no clicks rather than failing the dashboard.
  const list = (Array.isArray(clicks) ? [...clicks] : []).sort((a, b) => a.at - b.at);

  if (!list.length) {
    for (const m of ATTRIBUTION_MODELS) result[m].direct = 1;
    return result;
  }

  const spread = (model: AttributionModel, weights: number[]) => {
    const total = weights.reduce((a, b) => a + b, 0);
    list.forEach((c, i) => (result[model][c.platform] += weights[i]! / total));
  };
  const n = list.length;

  result.first_click[list[0]!.platform] = 1;
  result.last_click[list[n - 1]!.platform] = 1;
  spread('linear', list.map(() => 1));

  const halfLifeMs = TIME_DECAY_HALF_LIFE_DAYS * 86_400_000;
  spread('time_decay', list.map((c) => 2 ** (-Math.max(saleAt.getTime() - c.at, 0) / halfLifeMs)));

  spread('position_based', list.map((_, i) => (n === 1 ? 1 : n === 2 ? 0.5 : i === 0 || i === n - 1 ? 0.4 : 0.2 / (n - 2))));
  return result;
}
