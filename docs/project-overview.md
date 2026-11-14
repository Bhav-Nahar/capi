# Datahash: Offline & CRM Conversion Tracking for Ad Platforms

*A multi-tenant service that tells Meta and Google Ads about the sales their pixels never see.*

Source documents: `PLAN.md`, `SPEC.md`, `README.md`, and `docs/`. Statements about ad-platform rules that are marked **VERIFY** in those documents are marked the same way here, and nothing below is a measured result. No figure in this file is a promised uplift.

---

## 1. What it does (the one-minute version)

Datahash connects three things that normally never meet:

1. **The ad click** on the brand's website (Meta `fbclid`, Google `gclid` / `gbraid` / `wbraid`).
2. **The person**, once they identify themselves (a phone number or email on a form, a login, a WhatsApp chat, a billing counter).
3. **The sale**, which is recorded later in the brand's CRM (store purchase, WhatsApp-driven order, delayed online order).

When a sale is recorded, Datahash finds the person, finds the ad click that most likely led to the sale, and sends the sale **server to server** to:

- **Meta**: Conversions API (CAPI)
- **Google Ads**: Data Manager API (offline conversion import)

The ad platforms can then credit the right campaign, audience and creative, and their bidding algorithms learn from real revenue instead of only from what happens on the website.

---

## 2. Why it is needed

### The problem

For many businesses the sale that matters does not happen on the website. A jewellery customer clicks an ad, browses, then walks into a store a week later. A student fills a form and enrolls after a counselling call. A buyer chats on WhatsApp and pays in person.

The ad platforms never see these sales, so:

| Consequence | Effect on the brand |
|---|---|
| Reported ROAS is understated | Good campaigns look unprofitable and get cut |
| Bidding optimises for form fills / add-to-carts, not revenue | Budget goes to cheap leads that never buy |
| Store and WhatsApp revenue cannot be attributed to any campaign | Marketing cannot prove its contribution |
| Browser tracking keeps degrading (cookie limits, blockers, iOS) | Even online attribution loses signal |

### Why existing options fall short

- **Platform pixels** only see the website.
- **Platform plug-ins** (Shopify apps) cover online orders but not CRM-recorded sales.
- **Manual offline-conversion CSV uploads** are slow, error-prone, miss the click ID, and are rarely done consistently.
- **General tag-management or server-side GTM setups** need engineers to build and maintain, and do not handle identity merging, consent, retries or an audit trail.

### Who it is for

CRM-first and offline-first businesses: jewellery, real estate, education, clinics, automotive, and any brand where the website starts the journey but a person or a counter finishes it.

---

## 3. How it works

### 3.1 End-to-end flow

```
Ad click  ─►  brand.com/?gclid=…  or  ?fbclid=…
                │
                │  tracker.js (≈5.5 KB) stores the click ID + original click time
                │  in the visitor's own browser. Nothing is sent to us yet.
                ▼
Visitor identifies themselves (form, login, WhatsApp, checkout)
                │
                │  tracker.js sends phone/email (+ stored clicks) to /identify
                ▼
Collector  ─►  consent check  ─►  hash phone/email  ─►  store person + touches
                │                  (plain contact details are discarded after hashing)
                ▼
Later: a sale is recorded in the CRM (e.g. Zoho deal "Won")
                │
                │  webhook (+ optional daily sync to catch any missed ones)
                ▼
Ingest pipeline: normalise sale  ─►  find the person  ─►  consent + eligibility
                │                    pick the most recent click before the sale
                ▼
Delivery queue (one delivery per sale per platform, with retries)
                ▼
Meta CAPI     (physical_store / business_messaging / website; ph, em, fbc, fbp, event_id)
Google Ads    (click ID if we have it, otherwise hashed phone/email; order_id)
                ▼
Admin console: what was sent, skipped (and why), failed, match quality
```

### 3.2 The building blocks

| Component | What it does |
|---|---|
| **Website script** (`packages/tracker`) | Captures click IDs and UTMs on every page, keeps them in the visitor's browser, builds the Meta `fbc` value, auto-binds forms with phone/email fields, and exposes `datahash.identify()` for logins and custom flows. Honours the consent signal. |
| **Collector server** (`packages/server`) | Receives `/identify`, `/consent` (withdrawals), `/touch` (first-party cookie), CRM webhooks, and serves the admin API and console. |
| **Core rules** (`packages/core`) | Phone normalisation (E.164, default country per brand), email normalisation, SHA-256 hashing per platform, consent evaluation, choosing the right click, per-platform age limits. |
| **Ingest** (`packages/ingest`) | Turns each source into one standard sale: Zoho adapter (config-driven field mapping), generic JSON webhook, CSV import. Includes the Zoho daily sync. |
| **Senders** (`packages/senders`) | Meta and Google senders, retry/backoff policy, a dispatcher that works through the queue, a "send policy" kill switch, and a test-event path. |
| **Store** (`packages/store`) | Firestore data: people, click touches, sales, deliveries, tenants and site keys, encrypted ad-account connections. |
| **Operator console** (`packages/admin-next`) | Next.js console, exported as static files and served at `/admin`. |

### 3.3 Key design decisions

- **Nothing is stored about anonymous visitors.** Click IDs live in the visitor's browser (cookie and local storage). The server stores something only when the person identifies themselves and consent allows it.
- **Plain phone and email are never kept.** They are hashed for each platform and discarded.
- **Identity merging.** If a phone number and an email later turn out to be the same person, the records are merged in a transaction.
- **We send directly to the platforms**, not through sGTM tags, for retries, a full audit trail, per-brand credentials and control of hashing.
- **Stable de-duplication IDs** (`event_id` for Meta, `order_id` for Google) so retries and re-syncs never double count.
- **Sources are adapters; destinations are senders.** Adding HubSpot, Shopify or WhatsApp as a source, or TikTok or GA4 as a destination, does not change the pipeline in the middle.
- **No brand-specific code.** Everything that differs between brands (consent policy, allowed channels, destinations, default country, retention, CRM field mapping) is stored configuration. A new brand is onboarded in the console, with no deploy.

---

## 4. Features (everything that can go on a slide)

### Capture
- Lightweight first-party website script (≈5.5 KB), installed through Google Tag Manager or directly in the page head
- Google Tag Manager loader snippet for sites where a plain script tag loses its settings
- Captures `gclid`, `gbraid`, `wbraid`, `fbclid`, UTMs, landing URL and the *original click time*; keeps first and most recent touch
- Automatic form binding plus a manual `identify()` call for logins and custom flows
- Optional **first-party tracking address** (`track.brand.com`) with a server-set, signed cookie as a second copy of the click, and fewer losses to blockers
- "Check setup" in the console to verify the script is installed

### Identity & matching
- Phone and email normalisation and hashing, per platform
- Match by click ID first, then by hashed phone/email
- Picks the most recent eligible click before the sale
- Match-quality reporting: share of sales matched by click ID, by hashed contact only, or unmatched

### Sources (where sales come from)
- **Zoho CRM**: webhook on deal "Won", plus a daily sync to catch misses; per-brand field mapping
- **Generic JSON webhook** for any CRM or billing system
- **CSV import** with validation and a checked preview before anything is stored
- Per-brand webhook secret (only its hash is stored)
- Planned: Shopify, HubSpot, WhatsApp Business

### Destinations (where sales go)
- **Meta Conversions API**: `physical_store`, `business_messaging` (WhatsApp) and `website` actions; test event code support
- **Google Ads Data Manager API**: login by the product's Google *service account* (the brand adds one email, no per-brand secret, no Google app review) or by OAuth refresh token
- Per-platform sending switch for each brand
- Planned: TikTok, GA4

### Privacy & compliance
- **Consent policy per brand:** opt-in (safe default) or opt-out; consent withdrawals honoured
- **Data minimisation:** hashed identifiers only, configurable retention (default 90 days) with TTL clean-up
- **Right to erasure:** erase a person's data from the console
- Encrypted storage of ad-account tokens
- Tenant isolation (`tenants/{id}/…`), Firestore security rules

### Safety & control
- **Global kill switch** (`OUTBOUND_SENDS`) enforced inside the dispatcher: nothing leaves the server unless switched on; can be limited to chosen brands and platforms
- **Shadow mode:** sales are stored as pending/skipped without sending, so counts can be compared against the CRM and the platforms before going live
- **Eligibility rules per platform** (age windows, consent, channel), each skip recorded with a reason
- **Double-counting guard:** channel filter so offline sales are sent but online orders already reported by Shopify apps are not (default: offline channels only)
- Retries with backoff; failures recorded and retryable

### Operator console
- Brand list, create-brand wizard with safe defaults
- Per-brand tabs: **Overview** (setup guide, platform cards, items needing attention), **Website** (sites, install script, tracking address, DNS records), **CRM** (source, field mapping), **Ad Accounts** (Meta and Google connections), **Sales** (list, filters, import, per-sale delivery status and receipts), **Settings** (consent, retention, privacy, erase)
- Built-in debugging: send a **test event**, **test-mode banner**, **last run** summary, and a record of what Meta actually received

---

## 5. What the brand does vs what we do

| We provide | The brand provides |
|---|---|
| Website script and install snippet | Pasting the script (Tag Manager or page head) |
| Collector, hashing, matching, consent gate, senders | A form or flow that collects phone or email |
| Tracking address, certificate, cookie handling | One DNS record (`CNAME track → our collector`) |
| Delivery log and match-quality reporting | Consent banner and privacy wording (with their legal advisor) |
| | Access: Meta dataset token, Google Ads account access, CRM webhook |
| | Confirmation of other integrations that already report the same sales |

### Onboarding steps (target: about a day per brand)
1. Create the brand in the console (consent, country, retention, channels).
2. Install the script; confirm with **Check setup**.
3. Add the tracking-address DNS record (optional but recommended).
4. Connect the CRM and map its fields.
5. Connect Meta and Google Ads.
6. Send a **test event**; verify it in Meta Test Events and Google diagnostics.
7. Run in **shadow mode**, compare counts with CRM and platform reports.
8. Switch sending on per platform.

---

## 6. Honest limits (put these in the deck, it builds trust)

- Visitors who change device or browser before identifying themselves cannot be linked to their click.
- Cleared cookies, private mode, blocked scripts and in-app browsers lose click IDs.
- Safari may cap cookie life at about 7 days even for a CNAME'd address (**VERIFY** on real Safari).
- Without a click ID, Google matching is weaker than Meta matching.
- Results depend on how many customers give a phone or email, and how early.
- Platform rules (event age windows, API versions, error codes) are configuration marked **VERIFY** until confirmed on live accounts.

The console reports these directly: share matched by click ID, by contact only, unmatched, and skipped for consent or age.

---

## 7. Project status

| Area | Status |
|---|---|
| Capture script, identity store, consent | Built and tested locally |
| CRM ingestion (Zoho, generic, CSV) | Built and tested locally |
| Meta and Google senders, retry queue, kill switch | Built and tested locally; platform HTTP calls mocked in tests |
| Operator console (Next.js) | Built; migrated from the earlier console; audit findings closed |
| Automated tests | ~600 tests (unit plus Firestore-emulator); typecheck clean |
| Live traffic | **Not yet.** Needs a real Meta test event and a Google end-to-end sale on a test account, deployment, and a shadow-mode pilot |
| First customer | Lucira Jewellery (pilot). The product is brand-neutral; Lucira is the first tenant, not the shape of the product |

### Before real traffic
- Confirm every **VERIFY** item against current Meta/Google documentation and a live test account
- Replace the single shared admin token with per-user logins; add rate limiting on `/admin/api` and `/identify`
- Deploy Firestore indexes and TTL policies
- Use Cloud KMS / Secret Manager envelope encryption instead of the environment master key
- Pilot in shadow mode, then enable sending and monitor match quality and delivery for two weeks

### Roadmap
| Phase | Scope | Rough effort |
|---|---|---|
| 1 | Capture, ingest, senders, console, pilot with first brand | ~5–6 weeks |
| 2 | Multi-brand readiness: automated onboarding, per-brand databases, reporting in BigQuery/Looker Studio | ~3–4 weeks |
| 3 | Platform: user accounts and roles, OAuth connectors (Meta, Google, Zoho), more sources and destinations, billing | ~3–5 months |

---

## 8. Technology

TypeScript throughout (Node 22). Firestore for data, Cloud Run for the collector, esbuild for the website script, Next.js (static export) for the console, Vitest for tests, Docker Compose with the Firestore emulator for local development. Google Cloud Secret Manager / KMS planned for secrets. BigQuery and Looker Studio planned for reporting.

Rough running cost for a brand at about 50k sessions/day: **$55–110 per month** in infrastructure (list-price estimate, **VERIFY**). Sending to Meta and Google is free. Because the script stores clicks in the browser and calls the server only on identify, purchase and CRM events, server traffic is small (about 50k requests/month).

---

## 9. Suggested client-deck outline

| # | Slide | Content to use |
|---|---|---|
| 1 | Title | Product name, tagline: *"Tell Meta and Google about the sales their pixels can't see."* |
| 2 | The problem | Sales happen in stores, on WhatsApp and after calls; ad platforms see none of it (§2 table) |
| 3 | What that costs | Understated ROAS, bidding on the wrong signal, no proof of marketing's revenue |
| 4 | The solution | One-sentence flow: click → person → sale → platform (§1) |
| 5 | How it works | The flow diagram (§3.1) |
| 6 | What gets sent | Meta CAPI and Google Data Manager API, what each receives, de-duplication IDs |
| 7 | Privacy by design | Hashing, consent policy, retention, erasure, no storage of anonymous visitors |
| 8 | Sources & destinations | Zoho / webhook / CSV in; Meta / Google out; Shopify, HubSpot, WhatsApp, TikTok, GA4 next |
| 9 | The console | Screenshots: Overview, Sales with delivery status, Ad Accounts, test event |
| 10 | Safe rollout | Test event → shadow mode → per-platform switch on; kill switch |
| 11 | Onboarding in a day | The 8 steps (§5) and the split of responsibilities |
| 12 | Honest limits | §6, presented as how we report them, not hidden |
| 13 | Match quality | Click ID vs contact-only vs unmatched vs skipped (reporting that proves value) |
| 14 | Pilot & success measures | Delivery rate, share matched, zero duplicates, over two weeks in shadow then live |
| 15 | Roadmap | §7 table |
| 16 | Pricing idea | Charge by events sent and destinations connected, not by website traffic (not final) |
| 17 | Next steps | Access needed, DNS record, consent wording, kickoff date |

**Do not put on slides until measured on a live pilot:** match rates, ROAS or CPA improvement, and any uplift percentage.

---

## 10. FAQ (for sales conversations)

**Does it replace our pixel or Shopify apps?** No. It covers sales those cannot see. A channel filter prevents sending the same online order twice.

**Do you store our customers' phone numbers?** No. They are hashed for each platform and the plain values are discarded.

**What if a customer has not consented?** Under an opt-in policy nothing is stored or sent. Withdrawals are honoured and recorded.

**What if the CRM webhook misses a sale?** A daily sync catches missed deals, and a stable sale ID prevents duplicates.

**What if Meta or Google rejects an event?** It is retried with backoff; the reason is recorded and visible against the sale.

**Can we try it without risk?** Yes. Shadow mode stores and evaluates sales without sending, and a global switch stops all outbound sending.

**How long to go live?** Technical onboarding is about a day per brand once access is granted; the pilot is about two weeks to compare and confirm.
