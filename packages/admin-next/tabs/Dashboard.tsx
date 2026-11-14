'use client';
import { useState } from 'react';
import { Badge, Card, Skeleton } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import type { TabProps } from './types';
import { relTime } from './sales/format';

// ---- data shape (GET /tenants/{id}/dashboard) --------------------------------------------------------------
type Model = 'last_click' | 'first_click' | 'linear' | 'time_decay' | 'position_based';
type PlatformState = 'accepted' | 'confirming' | 'waiting' | 'rejected' | 'skipped';
interface PlatformSummary { accepted: number; confirming: number; waiting: number; rejected: number; skipped: number; revenueAccepted: number; acceptRate: number | null }
interface DashboardData {
  days: number;
  currency: string;
  totals: { sales: number; revenue: number; matchedToClick: number; accepted: number; revenueAccepted: number };
  funnel: Array<{ key: string; label: string; count: number }>;
  platforms: Partial<Record<'meta' | 'google_ads', PlatformSummary>>;
  daily: Array<{ date: string; sales: number; revenue: number; revenueAccepted: number }>;
  stores: Array<{ name: string; sales: number; revenue: number }>;
  skipReasons: Record<string, number>;
  attribution: Record<Model, Record<'google' | 'meta' | 'direct', { sales: number; revenue: number }>>;
  recent: Array<{ saleKey: string; eventId: string; occurredAt: string; value: number | null; currency: string | null; storeName: string | null; matchedToClick: boolean; platforms: Partial<Record<'meta' | 'google_ads', PlatformState>> }>;
}

// ---- formatting ------------------------------------------------------------------------------------------------
/** ₹1.97 Cr, ₹5.3 L, ₹85,000 for rupees; compact international notation otherwise. */
export function money(v: number, currency = 'INR', exact = false): string {
  if (currency === 'INR' && !exact) {
    const trim = (x: string) => x.replace(/\.0+$/, '');
    if (v >= 1e7) return `₹${trim((v / 1e7).toFixed(v >= 1e8 ? 1 : 2))} Cr`;
    if (v >= 1e5) return `₹${trim((v / 1e5).toFixed(1))} L`;
  }
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency, maximumFractionDigits: 0, ...(exact ? {} : { notation: currency === 'INR' ? 'standard' : 'compact' }) }).format(v);
  } catch {
    return `${Math.round(v)} ${currency}`;
  }
}
/** Whole percent, but never round 264/265 up to "100%" or 1/500 down to "0%". */
const pct = (part: number, whole: number) => {
  if (!whole) return '–';
  const p = (part / whole) * 100;
  const whole_ = Math.round(p);
  return (whole_ === 100 && part < whole) || (whole_ === 0 && part > 0) ? `${p.toFixed(1)}%` : `${whole_}%`;
};
const num = (v: number) => new Intl.NumberFormat('en-IN').format(v);
const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });

const PLATFORM_NAME = { meta: 'Meta', google_ads: 'Google Ads' } as const;
const STATE_LABEL: Record<PlatformState, string> = { accepted: 'Accepted', confirming: 'Confirming', waiting: 'Waiting', rejected: 'Rejected', skipped: 'Not sent' };
/**
 * Meta answers "received" as soon as it takes an event; whether it matched a person shows only in Meta's own Events
 * Manager. Google confirms after processing the sale. So the same state is worded per platform, never overstated.
 */
const stateLabel = (platform: 'meta' | 'google_ads', state: PlatformState) => (platform === 'meta' && state === 'accepted' ? 'Received' : STATE_LABEL[state]);
const STATE_TONE: Record<PlatformState, 'ok' | 'warn' | 'bad' | 'neutral'> = { accepted: 'ok', confirming: 'neutral', waiting: 'neutral', rejected: 'bad', skipped: 'neutral' };
const SKIP_LABEL: Record<string, string> = {
  no_consent: 'Customer did not agree to ad sharing',
  consent_withdrawn: 'Customer withdrew consent',
  channel_filtered: 'Channel not reported',
  no_identifiers: 'No phone, email or click to match on',
  too_old: 'Older than the platform allows',
};

const RANGES = [7, 30, 90] as const;

// ---- the page --------------------------------------------------------------------------------------------------
export function Dashboard({ id, view }: TabProps) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const dash = useApi<DashboardData>(`/tenants/${encodeURIComponent(id)}/dashboard?days=${days}`);
  const d = dash.data;
  const sendingOff = view.sending && !view.sending.allowed;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Store sales reported to your ads</h2>
          <p className="mt-0.5 text-sm text-muted">
            Last {days} days{dash.loading && d ? ' · updating…' : ''}
            {sendingOff && <span title={view.sending?.reason}> · <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">Sending off</span></span>}
          </p>
        </div>
        <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)} className={`rounded-md px-3 py-1 text-sm ${days === r ? 'bg-accent font-semibold text-accent-contrast' : 'text-muted hover:text-text'}`}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      {dash.error && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{dash.error}</p>}
      {!d && !dash.error && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
          <Skeleton className="h-72" />
        </div>
      )}
      {d && d.totals.sales === 0 && (
        <Card className="p-10 text-center">
          <h3 className="font-semibold">No sales in the last {days} days</h3>
          <p className="mt-1 text-sm text-muted">Sales appear here as soon as your systems send them.</p>
        </Card>
      )}
      {d && d.totals.sales > 0 && <Body d={d} />}
    </div>
  );
}

function Body({ d }: { d: DashboardData }) {
  const { totals } = d;
  const sent = d.funnel.find((f) => f.key === 'sent')?.count ?? 0;
  return (
    <>
      {/* Headline numbers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden p-5 lg:col-span-1">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
          <p className="text-sm text-muted">Revenue reported to ads</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-accent tabular-nums">{money(totals.revenueAccepted, d.currency)}</p>
          <p className="mt-1 text-xs text-muted">{pct(totals.revenueAccepted, totals.revenue)} of {money(totals.revenue, d.currency)} in store sales</p>
        </Card>
        <Stat label="Store sales received" value={num(totals.sales)} note={`Average bill ${money(totals.revenue / totals.sales, d.currency, true)}`} />
        <Stat label="Matched to an ad click" value={pct(totals.matchedToClick, totals.sales)} note={`${num(totals.matchedToClick)} sales came from a clicked ad`} />
        <Stat label="Reached Meta or Google" value={pct(totals.accepted, sent)} note={`${num(totals.accepted)} of ${num(sent)} sales sent`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2"><DailyChart d={d} /></Card>
        <Card className="p-5"><Funnel d={d} /></Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5"><Attribution d={d} /></Card>
        <div className="grid gap-3 lg:col-span-2 lg:grid-rows-2">
          {(['meta', 'google_ads'] as const).map((k) => d.platforms[k] && <PlatformCard key={k} platform={k} p={d.platforms[k]!} currency={d.currency} />)}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2"><Stores d={d} /></Card>
        <Card className="p-5 lg:col-span-3"><Recent d={d} /></Card>
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </Card>
  );
}

// ---- daily trend ---------------------------------------------------------------------------------------------
/** One series (revenue accepted per day) as bars, so no legend: the title names it. Hover or focus a day for detail. */
function DailyChart({ d }: { d: DashboardData }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(...d.daily.map((x) => x.revenueAccepted), 1);
  // A rounded top for the axis: 1, 2 or 5 times a power of ten.
  const step = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].map((m) => m * step).find((v) => v >= max)!;
  const ticks = [top, top / 2, 0];
  const shown = hover !== null ? d.daily[hover]! : null;
  const labelEvery = d.daily.length > 31 ? 14 : d.daily.length > 10 ? 7 : 1;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Revenue reported per day</h3>
          <p className="text-xs text-muted">Store sales accepted by Meta or Google, by sale date</p>
        </div>
        <button type="button" onClick={() => setTable(!table)} className="text-xs text-accent underline">{table ? 'Show chart' : 'Show as table'}</button>
      </div>

      {table ? (
        <div className="mt-4 max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Sales</th><th className="py-1 text-right font-medium">Revenue</th><th className="py-1 text-right font-medium">Reported</th></tr></thead>
            <tbody className="tabular-nums">
              {[...d.daily].reverse().map((x) => (
                <tr key={x.date} className="border-t border-border"><td className="py-1.5">{dayLabel(x.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td className="text-right">{x.sales}</td><td className="text-right">{money(x.revenue, d.currency, true)}</td><td className="text-right">{money(x.revenueAccepted, d.currency, true)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4">
          <div className="h-5 text-xs text-muted" aria-live="polite">
            {shown ? <span><span className="text-text">{dayLabel(shown.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span> · {money(shown.revenueAccepted, d.currency, true)} reported · {shown.sales} {shown.sales === 1 ? 'sale' : 'sales'}</span> : 'Hover a day for details'}
          </div>
          <div className="mt-2 flex gap-2">
            <div className="flex h-48 w-12 shrink-0 flex-col justify-between text-right text-[11px] text-muted tabular-nums" aria-hidden>
              {ticks.map((t) => <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{money(t, d.currency)}</span>)}
            </div>
            <div className="relative h-48 flex-1">
              <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
                {ticks.map((t) => <div key={t} className="border-t border-border/60" />)}
              </div>
              <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
                {d.daily.map((x, i) => (
                  <button
                    key={x.date}
                    type="button"
                    aria-label={`${dayLabel(x.date)}: ${money(x.revenueAccepted, d.currency, true)} reported, ${x.sales} sales`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="group relative flex h-full flex-1 items-end focus-visible:outline-none"
                  >
                    <span
                      className={`w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-accent-hover' : hover === null ? 'bg-accent' : 'bg-accent/45'} group-focus-visible:ring-2 group-focus-visible:ring-text`}
                      style={{ height: `${Math.max((x.revenueAccepted / top) * 100, x.revenueAccepted ? 1.5 : 0)}%` }}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="ml-14 mt-1.5 flex text-[11px] text-muted" aria-hidden>
            {d.daily.map((x, i) => (
              <span key={x.date} className="flex-1 whitespace-nowrap">{i % labelEvery === 0 ? dayLabel(x.date) : ''}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- funnel -------------------------------------------------------------------------------------------------------
function Funnel({ d }: { d: DashboardData }) {
  const first = d.funnel[0]?.count || 1;
  return (
    <div>
      <h3 className="font-semibold">From sale to ad platform</h3>
      <p className="text-xs text-muted">Each step is part of the one above</p>
      <ol className="mt-4 space-y-4">
        {d.funnel.map((f, i) => (
          <li key={f.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{f.label}</span>
              <span className="tabular-nums"><span className="font-semibold">{num(f.count)}</span> <span className="text-xs text-muted">{pct(f.count, first)}</span></span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${i === d.funnel.length - 1 ? 'bg-accent' : 'bg-accent/55'}`} style={{ width: `${(f.count / first) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
      {Object.keys(d.skipReasons).length > 0 && (
        <div className="mt-5 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted">Not sent, and why</p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {Object.entries(d.skipReasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
              <li key={r} className="flex justify-between gap-2"><span className="text-muted">{SKIP_LABEL[r] ?? r}</span><span className="tabular-nums">{n}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- attribution ---------------------------------------------------------------------------------------------------
const MODELS: Array<{ key: Model; label: string; help: string }> = [
  { key: 'last_click', label: 'Last click', help: 'The ad clicked last before the sale gets the credit.' },
  { key: 'first_click', label: 'First click', help: 'The ad that first brought the customer gets the credit.' },
  { key: 'linear', label: 'Even split', help: 'Credit is shared evenly across every ad click before the sale.' },
  { key: 'time_decay', label: 'Recent counts more', help: 'Every ad click shares the credit, but a click counts half as much for each week it came before the sale.' },
  { key: 'position_based', label: 'Both ends', help: 'The first and last ad clicks get 40% each; the clicks in between share the other 20%.' },
];
const SOURCES = [
  { key: 'google', label: 'Google Ads', bar: 'bg-accent' },
  { key: 'meta', label: 'Meta', bar: 'bg-accent' },
  { key: 'direct', label: 'No ad click', bar: 'bg-muted/50' },
] as const;

/** One measure (revenue credited) per source, as labelled bars: identity is in the text, so one hue is enough. */
function Attribution({ d }: { d: DashboardData }) {
  const [model, setModel] = useState<Model>('last_click');
  const cells = d.attribution[model];
  const total = d.totals.revenue || 1;
  const active = MODELS.find((m) => m.key === model)!;
  return (
    <div>
      <h3 className="font-semibold">Which ads brought the sales</h3>
      <p className="text-xs text-muted">Store revenue, credited by the ad clicks in the 30 days before each sale</p>
      <div role="group" aria-label="Credit model" className="mt-3 flex flex-wrap gap-0.5 rounded-lg border border-border bg-bg p-0.5">
        {MODELS.map((m) => (
          <button key={m.key} type="button" aria-pressed={model === m.key} onClick={() => setModel(m.key)} className={`rounded-md px-2.5 py-1 text-xs ${model === m.key ? 'bg-surface-2 font-semibold text-text' : 'text-muted hover:text-text'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <ul className="mt-4 space-y-3.5">
        {SOURCES.map((s) => {
          const c = cells[s.key];
          return (
            <li key={s.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{s.label}</span>
                <span className="tabular-nums"><span className="font-semibold">{money(c.revenue, d.currency)}</span> <span className="text-xs text-muted">{pct(c.revenue, total)} · {num(Math.round(c.sales * 10) / 10)} sales</span></span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-surface-2"><div className={`h-full rounded-full ${s.bar}`} style={{ width: `${(c.revenue / total) * 100}%` }} /></div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted">{active.help} For your reporting only: Meta and Google still count conversions their own way.</p>
    </div>
  );
}

// ---- per platform -------------------------------------------------------------------------------------------------
const SEGMENTS: Array<{ key: PlatformState; bar: string; dot: string }> = [
  { key: 'accepted', bar: 'bg-ok', dot: 'bg-ok' },
  { key: 'confirming', bar: 'bg-muted/60', dot: 'bg-muted/60' },
  { key: 'waiting', bar: 'bg-border', dot: 'bg-border' },
  { key: 'rejected', bar: 'bg-bad', dot: 'bg-bad' },
];

function PlatformCard({ platform, p, currency }: { platform: 'meta' | 'google_ads'; p: PlatformSummary; currency: string }) {
  const name = PLATFORM_NAME[platform];
  const label = (state: PlatformState) => stateLabel(platform, state);
  const total = p.accepted + p.confirming + p.waiting + p.rejected;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{name}</h3>
          <p className="text-xs text-muted">{money(p.revenueAccepted, currency)} reported</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{p.acceptRate === null ? '–' : `${(p.acceptRate * 100).toFixed(1)}%`}</p>
          <p className="text-xs text-muted">{platform === 'meta' ? 'received' : 'accepted'}</p>
        </div>
      </div>
      {total > 0 && (
        <div className="mt-4 flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={SEGMENTS.map((s) => `${label(s.key)} ${p[s.key]}`).join(', ')}>
          {SEGMENTS.filter((s) => p[s.key] > 0).map((s) => <div key={s.key} className={s.bar} style={{ width: `${(p[s.key] / total) * 100}%` }} />)}
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {SEGMENTS.filter((s) => p[s.key] > 0 || s.key === 'accepted').map((s) => (
          <li key={s.key} className="flex items-center gap-1.5"><span aria-hidden className={`h-2 w-2 rounded-full ${s.dot}`} /><span className="text-muted">{label(s.key)}</span><span className="tabular-nums">{num(p[s.key])}</span></li>
        ))}
        {p.skipped > 0 && <li className="flex items-center gap-1.5"><span className="text-muted">Not sent</span><span className="tabular-nums">{num(p.skipped)}</span></li>}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {platform === 'meta' ? 'Meta confirms it received each sale. How many it matched to people shows in Meta Events Manager.' : 'Google confirms each sale after processing it, usually within a day.'}
      </p>
    </Card>
  );
}

// ---- stores and recent sales -----------------------------------------------------------------------------------
function Stores({ d }: { d: DashboardData }) {
  const max = Math.max(...d.stores.map((s) => s.revenue), 1);
  return (
    <div>
      <h3 className="font-semibold">Top stores</h3>
      <p className="text-xs text-muted">By store sales value</p>
      <ul className="mt-4 space-y-3.5">
        {d.stores.map((s) => (
          <li key={s.name}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 tabular-nums">{money(s.revenue, d.currency)} <span className="text-xs text-muted">· {s.sales}</span></span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent/80" style={{ width: `${(s.revenue / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Recent({ d }: { d: DashboardData }) {
  return (
    <div>
      <h3 className="font-semibold">Latest sales</h3>
      <p className="text-xs text-muted">Newest first</p>
      <ul className="mt-3 divide-y divide-border">
        {d.recent.map((s) => (
          <li key={s.saleKey} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium tabular-nums">{s.value !== null ? money(s.value, s.currency ?? d.currency, true) : '–'}</span>
                {s.matchedToClick && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Ad click</span>}
              </div>
              <div className="truncate text-xs text-muted">{s.storeName ?? 'Store not stated'} · {relTime(s.occurredAt)} · <span className="font-mono">{s.eventId}</span></div>
            </div>
            <div className="flex gap-1.5">
              {(['meta', 'google_ads'] as const).map((k) => s.platforms[k] && (
                <span key={k} title={`${PLATFORM_NAME[k]}: ${stateLabel(k, s.platforms[k]!)}`}>
                  <Badge tone={STATE_TONE[s.platforms[k]!]}>{k === 'meta' ? 'Meta' : 'Google'} · {stateLabel(k, s.platforms[k]!)}</Badge>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
