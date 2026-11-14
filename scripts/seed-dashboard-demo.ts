/**
 * A realistic demo brand for the client dashboard: 60 days of store sales across five showrooms, about half of them
 * matched to a website ad click, with deliveries in the states a live brand would show (accepted, still being
 * confirmed by Google, 12-15% refused, a few skipped for consent, the last hour still waiting).
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8181 npx tsx scripts/seed-dashboard-demo.ts
 *
 * LOCAL EMULATOR ONLY: refuses to run without FIRESTORE_EMULATOR_HOST. Nothing here talks to Meta or Google; the
 * delivery results are written directly. Same numbers every run (fixed random seed). Phone numbers are made up.
 */
import { ConnectionsRepo, createFirestore, SalesRepo, SecretBox, Store, TenantRegistry } from '@datahash/store';
import { processSale, type IncomingSale } from '@datahash/ingest';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (this script is for the local emulator only).');
  process.exit(1);
}

// Small deterministic PRNG (mulberry32), so the demo looks the same every time.
let seed = 20261114;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

const db = createFirestore();
const registry = new TenantRegistry(db, { cacheMs: 0 });
const box = new SecretBox(process.env.SECRETS_KEY ?? 'ZGV2LW9ubHktc2VjcmV0cy1rZXktMzItYnl0ZXMhISE=');

const { tenant } = await registry.createTenant({
  name: 'Demo Jewellers',
  tenantId: `demo-jewellers-${Date.now().toString(36)}`,
  origins: ['https://demo-jewellers.example.com'],
  consentMode: 'opt_out',
  allowedChannels: ['store'],
  destinations: ['meta', 'google_ads'],
});
const store = new Store(db, { tenantId: tenant.tenantId });
const sales = new SalesRepo(db, { tenantId: tenant.tenantId });
const connections = new ConnectionsRepo(db, box, tenant.tenantId);
// Placeholders so the Ad accounts tab shows both platforms connected. Never used: sending stays off.
await connections.set('meta', { datasetId: '1234567890123456', testEventCode: 'TEST12345' }, 'PLACEHOLDER-NOT-A-REAL-TOKEN');
await connections.set('google_ads', { customerId: '123-456-7890', conversionActionId: '987654321', authMethod: 'service_account' });

const STORES = [
  ['Mumbai · Bandra', 1.4],
  ['Pune · FC Road', 1.1],
  ['Bengaluru · Indiranagar', 1.0],
  ['Delhi · South Extension', 0.9],
  ['Hyderabad · Banjara Hills', 0.6],
] as const;
const CAMPAIGNS = ['wedding-season', 'diamond-solitaires', 'gold-coins', 'everyday-fine-jewellery'];

/** A plausible bill: mostly ₹15k-₹90k, some bridal pieces up to ₹4.5L. */
const billValue = () => {
  const base = chance(0.12) ? 150000 + rand() * 300000 : 15000 + Math.pow(rand(), 1.6) * 75000;
  return Math.round(base / 100) * 100;
};

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let phoneSeq = 0;
const newPhone = () => `98${String(20000000 + ++phoneSeq * 7919).slice(-8)}`;
let invoice = 41000;
let count = 0;

for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
  const day = new Date(now - daysAgo * DAY);
  const weekend = [0, 6].includes(day.getUTCDay());
  // Growing trend over the period, busier weekends, a festive bump around three weeks ago.
  const festive = daysAgo >= 18 && daysAgo <= 24 ? 1.8 : 1;
  const expected = (4 + (59 - daysAgo) * 0.06) * (weekend ? 1.5 : 1) * festive;
  const n = Math.max(1, Math.round(expected * (0.75 + rand() * 0.5)));

  for (let i = 0; i < n; i++) {
    // Showroom hours, 11:00-20:30 India time.
    const minutes = 11 * 60 + Math.floor(rand() * 9.5 * 60);
    const occurredAt = new Date(Date.parse(`${new Date(now - daysAgo * DAY + 5.5 * HOUR).toISOString().slice(0, 10)}T00:00:00+05:30`) + minutes * 60_000);
    if (occurredAt.getTime() > now - 10 * 60_000) continue; // nothing in the future

    const phone = newPhone();
    const declined = chance(0.04);
    // About half the buyers clicked an ad and left their number on the website first.
    if (!declined && chance(0.5)) {
      const googleTouch = (clickedAt: Date) => ({ clickedAt, gclid: `DEMO-G-${phoneSeq}-${clickedAt.getTime()}`, utm: { utm_source: 'google', utm_campaign: pick(CAMPAIGNS) } });
      const metaTouch = (clickedAt: Date) => ({ clickedAt, fbclid: `DEMO-F-${phoneSeq}-${clickedAt.getTime()}`, fbc: `fb.1.${clickedAt.getTime()}.DEMO-F-${phoneSeq}`, utm: { utm_source: 'meta', utm_campaign: pick(CAMPAIGNS) } });
      const clickedAt = new Date(occurredAt.getTime() - (1 + rand() * 20) * DAY);
      const between = () => new Date(clickedAt.getTime() + rand() * (occurredAt.getTime() - clickedAt.getTime() - HOUR));
      const touches = [];
      if (chance(0.45)) {
        // Journeys over several clicks (2-4), on both platforms. The typical pattern the demo shows: a Google search
        // brings the customer in, Meta ads (retargeting) bring them back before they visit the showroom.
        const times = [clickedAt, ...Array.from({ length: 1 + Math.floor(rand() * 3) }, between)].sort((x, y) => x.getTime() - y.getTime());
        const firstGoogle = chance(0.8);
        const lastMeta = chance(0.8);
        times.forEach((t, i) => {
          const isFirst = i === 0, isLast = i === times.length - 1;
          let useGoogle = isFirst ? firstGoogle : isLast ? !lastMeta : chance(0.4);
          // Two clicks on the same platform is a single-platform journey: keep these mixed.
          if (isLast && times.length === 2 && useGoogle === firstGoogle) useGoogle = !firstGoogle;
          touches.push(useGoogle ? googleTouch(t) : metaTouch(t));
        });
      } else {
        touches.push(chance(0.5) ? googleTouch(clickedAt) : metaTouch(clickedAt));
      }
      await store.identify({ phone, consent: { ads: true, source: 'website' }, now: new Date(Math.max(...touches.map((t) => t.clickedAt.getTime())) + HOUR), touches });
    }

    const weights = STORES.map(([, w]) => w);
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    const storeName = STORES.find(([, w]) => (r -= w) < 0)?.[0] ?? STORES[0][0];

    const sale: IncomingSale = {
      source: 'webhook', eventId: `INV-${++invoice}`, eventName: 'Purchase', channel: 'store', occurredAt,
      value: billValue(), currency: 'INR', storeName, phone, consent: !declined,
    };
    const recordedAt = new Date(occurredAt.getTime() + 5 * 60_000);
    const res = await processSale(sale, tenant, { store, sales, now: () => recordedAt });

    const ageHours = (now - occurredAt.getTime()) / HOUR;
    const badSale = chance(0.08);
    for (const d of res.deliveries) {
      if (d.status !== 'pending') continue;
      if (ageHours < 1) continue; // the last hour is still waiting to be sent
      const sentAt = new Date(recordedAt.getTime() + 2 * 60_000);
      const token = (await sales.claimDelivery(res.saleKey, d.destination, sentAt))!;
      // Realistic refusals: some sales are refused by both (bad data), plus each platform's own refusals.
      // Lands near 85-88% per platform, in line with what live accounts report (75-90%).
      const refused = badSale || chance(d.destination === 'meta' ? 0.05 : 0.07);
      if (d.destination === 'meta') {
        await sales.completeDelivery(res.saleKey, 'meta', refused
          ? { status: 'failed', error: 'meta 400 code 100: Invalid parameter', leaseToken: token }
          : { status: 'sent', response: 'events_received=1', leaseToken: token }, sentAt);
      } else {
        await sales.completeDelivery(res.saleKey, 'google_ads', { status: 'sent', response: 'accepted', requestId: `REQ-${invoice}`, processingNextCheckAt: new Date(sentAt.getTime() + HOUR), leaseToken: token }, sentAt);
        // Google reports its result within about a day; younger sales are still being confirmed.
        if (ageHours > 20) {
          await sales.recordProcessing(res.saleKey, 'google_ads', refused ? { status: 'rejected', checks: 1, detail: 'CONVERSION_PRECEDES_CLICK x1' } : { status: 'success', checks: 1 });
        }
      }
    }
    count++;
  }
}

console.log(`Demo brand "${tenant.name}" (${tenant.tenantId}): ${count} sales over 60 days.`);
