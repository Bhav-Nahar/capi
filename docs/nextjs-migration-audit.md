# Next.js admin migration audit

## Follow-up verification: findings closed

Verified the follow-up fixes on 13 October 2026. All five findings below are resolved in the current local implementation:

- Metadata failures display errors and retry controls; regression tests cover successful recovery.
- New-brand dialogs unmount between uses. Browser verification confirmed reopening restores opt-in defaults.
- Modal and confirmation dialogs use native `showModal()`. Browser verification confirmed the modal is in the top layer and keyboard cycling returns inside it rather than enabling background controls.
- Legacy hash links translate to the appropriate brand/tab address. A real browser check confirmed redirect and sign-in at the destination.
- Next development mode proxies API requests to the collector. A read-only request to the Next server's `/admin/api/me` returned HTTP 200 with `{"ok":true}` through the running local collector.

Type checking, all 89 frontend tests, and the default `npm run build:release` passed. The earlier Turbopack build limitation did not recur. Outbound sending remained disabled throughout browser/proxy verification. No production deployment or live Meta/Google delivery was tested. The original findings and evidence below are retained as historical context.

Reviewed 13 October 2026 against the current working tree. Scope: migration from `admin-ui` to the static-exported `admin-next` console, collector routing, and shared backend workflows. No production deployment, live ad sending or production configuration changes were performed.

## Findings

### P2: Failed metadata request leaves the brand page permanently loading

`packages/admin-next/app/brand/BrandPage.tsx:41` handles `view.error` but never `meta.error`. A successful tenant response plus HTTP 500 from `/admin/api/meta` leaves the skeleton indefinitely, hiding the failure and offering no retry. The old console's route-level error handler exposed this failure. Reproduced with a temporary component test. The Brands page also silently disables New brand if its metadata request fails.

Fix: display metadata failures with a retry action on both pages.

### P2: New-brand defaults leak from the previous dialog

`packages/admin-next/components/brands/NewBrandDialog.tsx:51` resets name, origins and host, but not consent, country, retention, channels, destinations or the Zoho choice. The component remains mounted between openings. Reproduced in the built console: choose opt-out, cancel, reopen New brand; opt-out remains selected instead of the original safe opt-in default. The same applies after creating a brand and opening another new-brand dialog. The old console created fresh controls for each dialog.

Fix: reset every form field on a fresh opening, or unmount the dialog between uses. Preserve drafts only if explicitly intended and clearly communicated.

### P2: Modal dialogs no longer contain keyboard focus

`packages/admin-next/components/ui.tsx:95` uses a div with `aria-modal` instead of the old native modal dialog. It focuses a control initially but supplies neither a focus trap nor inert background. Reproduced in the built console: Tab from Create brand leaves the dialog. ConfirmDialog has the same underlying limitation. Keyboard users can reach and activate background controls while the modal is open.

Fix: use a native modal dialog or an accessible dialog implementation with focus containment, background inertness, and correct nested-dialog handling.

### P2: Existing hash-based bookmarks no longer open the intended page

The old console supported `/admin/#/brand/<id>/sales` and similar links. The new Home/BrandPage routing ignores the hash and expects `/admin/brand/?id=<id>&tab=sales`. Reproduced with a real existing emulator brand: the old Sales link opens the Brands list instead.

Fix: translate supported legacy hashes to the equivalent Next.js URL, including the old import route.

### P2: Standalone Next development mode has no API proxy

`packages/admin-next/package.json` offers `next dev -p 3100`. `lib/api.ts:38` says development uses a rewrite, but `next.config.mjs` defines no rewrite. With the default empty API base, requests go to the Next server's `/admin/api`, where no handlers exist, rather than the collector. This was identified from configuration inspection; the separate Next dev server was not exercised. The documented build-then-collector workflow works.

Fix: supply a development-only proxy to the collector, while keeping production a same-origin static export. A cross-origin API base alone is insufficient without appropriate server CORS support.

## Verification

- Type checking passed for the backend and the new frontend.
- All 80 existing Next.js component tests passed (brands, website, CRM, connections, overview, settings, and sales).
- Full emulator suite: 598 passed; one dispatcher test exceeded a manually supplied 15-second timeout. Rerunning its 21-test file alone with a 30-second timeout passed all tests, including the previously timed-out test. No functional backend failure was reproduced.
- Three additional temporary audit tests reproduced hidden metadata errors, a stale response after `useApi` is disabled, and delivery receipt information being available only via badge title rather than visible text. Temporary tests were removed afterward. The receipt presentation existed previously and is not a migration regression. The disabled-hook result is a hardening concern; a cross-brand write was not demonstrated.
- Default Turbopack release build failed because the host denied a local port needed by PostCSS processing, including after an escalated retry. This is an environment limitation, not established evidence of an application defect.
- `next build --webpack` successfully compiled and exported the current frontend. The freshly exported files were served through the local collector with sending off. Sign-in, brand loading, client navigation, Sales, and website/GTM installation controls worked. Browser tests also reproduced the dialog/default/bookmark findings above.
- Backend integration tests cover ingestion, identity matching, queue/dispatch, platform response handling, Google processing, connection settings, consent, and erasure. Platform HTTP calls are mocked; this audit does not establish live Meta/Google acceptance of a new deployed frontend revision.

## Assessment

Core workflows are retained and no migration-caused conversion ingestion or sending failure was reproduced. Fix the confirmed dialog defaults, metadata handling, keyboard behavior and legacy navigation before considering parity complete. Add development proxy configuration if standalone Next dev is an intended workflow. Validate the default build in the intended CI/deployment environment.
