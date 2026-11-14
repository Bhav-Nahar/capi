import { describe, expect, it } from 'vitest';
import { genericLogView, mapGenericSale } from '../src';

const now = new Date('2026-10-08T00:00:00Z');
const base = { eventId: 'o1', channel: 'store', occurredAt: '2026-10-07T10:00:00+05:30', value: 85000 };

describe('the standard JSON: Purchase only', () => {
  it('a Purchase with a value is accepted, and eventName defaults to Purchase', () => {
    expect(mapGenericSale(base, now)).toMatchObject({ ok: true, sale: { eventName: 'Purchase', value: 85000, currency: 'INR' } });
    expect(mapGenericSale({ ...base, eventName: 'Purchase', currency: 'usd' }, now)).toMatchObject({ ok: true, sale: { currency: 'USD' } });
  });

  it('other events are refused for now', () => {
    expect(mapGenericSale({ ...base, eventName: 'Lead' }, now)).toEqual({ ok: false, reason: 'unsupported_event', detail: 'Lead' });
    expect(mapGenericSale({ ...base, eventName: 'purchase' }, now)).toMatchObject({ ok: false, reason: 'unsupported_event' });
  });

  it('a Purchase needs a value (Meta refuses one without) and a 3-letter currency', () => {
    const { value: _v, ...noValue } = base;
    expect(mapGenericSale(noValue, now)).toEqual({ ok: false, reason: 'missing_value' });
    expect(mapGenericSale({ ...base, value: '' }, now)).toEqual({ ok: false, reason: 'missing_value' });
    expect(mapGenericSale({ ...base, value: 0 }, now)).toMatchObject({ ok: true, sale: { value: 0 } });
    expect(mapGenericSale({ ...base, currency: 'Rupees' }, now)).toMatchObject({ ok: false, reason: 'invalid_amount' });
  });

  it('a sale dated in the future is refused', () => {
    expect(mapGenericSale({ ...base, occurredAt: '2026-10-09T10:00:00Z' }, now)).toEqual({ ok: false, reason: 'invalid_date', detail: 'in the future' });
  });

  it('takes date of birth and gender, and never logs them', () => {
    const r = mapGenericSale({ ...base, dateOfBirth: '1997-02-16', gender: 'female' }, now);
    expect(r).toMatchObject({ ok: true, sale: { dateOfBirth: '1997-02-16', gender: 'female' } });
    const logged = genericLogView({ ...base, dateOfBirth: '1997-02-16', gender: 'female' });
    expect(logged).toMatchObject({ dateOfBirth: '[redacted]', gender: '[redacted]' });
  });
});
