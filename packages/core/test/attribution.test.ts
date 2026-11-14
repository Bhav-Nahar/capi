import { describe, expect, it } from 'vitest';
import { adClicksBefore, attributeSale, MAX_ATTRIBUTION_CLICKS, touchPlatform, type AdClick } from '../src/attribution';

const sale = new Date('2026-11-13T12:00:00Z');
const daysBefore = (d: number) => new Date(sale.getTime() - d * 86_400_000);
const ms = (d: number) => daysBefore(d).getTime();
const g = (d: number): AdClick => ({ at: ms(d), platform: 'google' });
const m = (d: number): AdClick => ({ at: ms(d), platform: 'meta' });

describe('which platform a click belongs to', () => {
  it('Google: gclid, gbraid, wbraid. Meta: fbclid, fbc, WhatsApp click', () => {
    expect(touchPlatform({ gclid: 'x' })).toBe('google');
    expect(touchPlatform({ wbraid: 'x' })).toBe('google');
    expect(touchPlatform({ fbc: 'fb.1.1.x' })).toBe('meta');
    expect(touchPlatform({ ctwaClid: 'x' })).toBe('meta');
    expect(touchPlatform({})).toBeNull();
  });
});

describe('ad clicks before a sale', () => {
  const touches = [
    { id: 'b', clickedAt: daysBefore(5), gclid: 'g2' },
    { id: 'a', clickedAt: daysBefore(20), gclid: 'g1' },
    { id: 'c', clickedAt: daysBefore(10), fbclid: 'f1' },
    { id: 'c2', clickedAt: daysBefore(10), fbc: 'fb.1.x.f1' }, // the same click stored twice
    { id: 'old', clickedAt: daysBefore(45), fbclid: 'f0' }, // outside the 30-day window
    { id: 'after', clickedAt: new Date(sale.getTime() + 60_000), gclid: 'g3' }, // after the sale
    { id: 'organic', clickedAt: daysBefore(2), utm: { utm_source: 'newsletter' } }, // not an ad click
  ];

  it('keeps every ad click in the window, oldest first, each once', () => {
    expect(adClicksBefore(touches, sale)).toEqual([g(20), m(10), g(5)]);
  });

  it('nothing when there are no ad clicks in the window', () => {
    expect(adClicksBefore([touches[4]!, touches[6]!], sale)).toBeUndefined();
  });

  it('a very active customer: keeps the first click and the most recent ones', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, clickedAt: daysBefore(26 - i), gclid: `g${i}` }));
    const kept = adClicksBefore(many, sale)!;
    expect(kept).toHaveLength(MAX_ATTRIBUTION_CLICKS);
    expect(kept[0]).toEqual(g(26));
    expect(kept.at(-1)).toEqual(g(2));
  });
});

describe('credit per model', () => {
  const sum = (s: { google: number; meta: number; direct: number }) => s.google + s.meta + s.direct;

  it('no click: direct under every model', () => {
    const a = attributeSale(undefined, sale);
    for (const shares of Object.values(a)) expect(shares).toEqual({ google: 0, meta: 0, direct: 1 });
  });

  it('a single click gets everything under every model', () => {
    const a = attributeSale([m(3)], sale);
    for (const shares of Object.values(a)) expect(shares).toEqual({ google: 0, meta: 1, direct: 0 });
  });

  it('Google, then Meta, then Meta: each model credits differently', () => {
    const a = attributeSale([g(20), m(10), m(1)], sale);
    expect(a.first_click).toEqual({ google: 1, meta: 0, direct: 0 });
    expect(a.last_click).toEqual({ google: 0, meta: 1, direct: 0 });
    expect(a.linear.google).toBeCloseTo(1 / 3);
    // Both ends: first 40%, last 40%, the one between 20%.
    expect(a.position_based.google).toBeCloseTo(0.4);
    expect(a.position_based.meta).toBeCloseTo(0.6);
    // Recent counts more: the 20-day-old Google click weighs 2^-20/7, far less than the recent Meta clicks.
    const wg = 2 ** (-20 / 7), wm = 2 ** (-10 / 7) + 2 ** (-1 / 7);
    expect(a.time_decay.google).toBeCloseTo(wg / (wg + wm));
    for (const shares of Object.values(a)) expect(sum(shares)).toBeCloseTo(1);
  });

  it('two clicks: both ends splits 50/50', () => {
    expect(attributeSale([g(9), m(2)], sale).position_based).toEqual({ google: 0.5, meta: 0.5, direct: 0 });
  });
});
