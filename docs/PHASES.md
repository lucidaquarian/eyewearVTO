# Phase Details

Companion to [PLAN.md](./PLAN.md). Task-level detail, file references, and
acceptance criteria per phase. Phase 4 (the converter) has its own standalone
handoff document: [eyewear-forge-handoff.md](./eyewear-forge-handoff.md) —
that doc is designed to be copied into the new repository as its founding spec.

---

## Phase 0 — Decisions & reconnaissance

**Objective:** retire every "unknown" that would force rework in Phases 1–3.
No code. Output = the decision table in PLAN.md filled in.

### Tasks

1. **VisionKart reconnaissance.** Add `thelucidaquarian/visionKart` to the
   session/repo scope. Record: React version, bundler (Vite / webpack / Next),
   SSR or SPA, styling system, whether Three.js is already a dependency
   (`pnpm why three`), existing CSP headers, deploy target.
2. **Distribution channel decision.** Recommended: GitHub Packages (private
   npm) with per-customer read tokens. Alternatives: public npm (weakest),
   hosted script bundle (strongest control, worst DX). Whatever is chosen
   defines Phase 1's build outputs (ESM lib vs. also an IIFE bundle).
3. **Free-tier / trial policy.** Recommended: hard-fail without a key;
   trials are ordinary keys with `expires_at = now() + 14 days`.
4. **Keys-per-environment policy.** Recommended: two keys per customer
   (staging + production); `localhost`/preview origins only on staging keys.
5. **License backend host.** Recommended: Supabase Edge Functions.
6. **Converter repo naming + language.** See handoff doc; default is a new
   repo `eyewear-forge`, Python CV service + Node/three.js generator.

### Acceptance criteria

- Every row of the PLAN.md Phase-0 table has an answer.
- VisionKart facts recorded in PLAN.md (or a short `docs/visionkart-notes.md`).

---

## Phase 1 — VTO plugin extraction

**Objective:** `src/vto/` becomes `@yourorg/eyewear-vto`, installable in any
React 18 host. The current app survives as the demo site.

### 1.1 Monorepo restructure (~0.5 day)

- Move to pnpm workspaces:
  - `packages/eyewear-vto/` ← everything under `app/src/vto/` plus
    `app/src/lib/ReleaseGLContext.tsx` (currently imported by
    `SceneCanvas.tsx` from outside the vto tree — it moves inside).
  - `apps/vto-demo/` ← the remaining shell (`main.tsx`, `index.html`,
    `index.css`, Tailwind config, `deploy/`, `railway.json` pointing at the
    new path).
- Root `pnpm-workspace.yaml`; demo depends on the package via
  `workspace:*`.

### 1.2 Library build (~1 day)

- `packages/eyewear-vto/vite.config.ts` in **lib mode**: ESM output,
  `dts` plugin for types, `preserveModules` optional.
- `peerDependencies`: `react`, `react-dom`, `three`, `@react-three/fiber`,
  `@react-three/drei` (Three.js MUST be a single instance in any host —
  document required version ranges). `zustand` and
  `@mediapipe/tasks-vision` stay as regular `dependencies`.
- Exports map: `.` (components), `./styles.css` (compiled stylesheet).

### 1.3 Portability fixes (~1.5 days)

- **Worker import**: `lib/faceWorkerClient.ts:1` uses the Vite-only
  `?worker` suffix. Replace with
  `new Worker(new URL('../workers/faceLandmarker.worker.ts', import.meta.url), { type: 'module' })`
  — works in Vite, webpack 5, and Next.
- **Asset paths**: `lib/mediapipe.ts` hardcodes `/mediapipe` +
  `/mediapipe/face_landmarker.task`. Introduce a config object
  (`assetsBaseUrl`, individually overridable `wasmPath` / `modelPath`)
  threaded via React context from the root component. Same for catalog GLB /
  thumbnail URLs.
- **Catalog as prop**: `data/frames.ts` currently imports `frames.json` at
  build time. The root component accepts `frames?: Frame[]`; the bundled
  JSON becomes the demo app's concern, not the package's.

### 1.4 Style scoping (~1 day)

- Tailwind config gains `prefix: 'vto-'` + `corePlugins.preflight: false`
  for the package build; a codemod pass over `className` strings (or keep
  unprefixed classes and compile with `important: '.vto-root'` scoping —
  decide during implementation, prefix is the safer default).
- Remove global `html, body, #root` rules from the package's CSS; the root
  component carries its own font-family/color styles on its own wrapper.
- Ship exactly one `styles.css`; host imports it once.

### 1.5 Host-facing API (~1 day)

```tsx
<EyewearVTO
  licenseKey="vto_live_..."
  frames={customCatalog}          // optional; defaults to demo catalog
  assetsBaseUrl="/vto-assets"     // where mediapipe/ + glasses/ are served
  showHeader={false}              // Header/Footer default OFF in the package
  showFooter={false}
  onCapture={(blob, meta) => {}}
  onPdMeasured={(pdMm, confidence) => {}}
  onError={(err) => {}}           // error beacon hook (Phase 2 uses this too)
  theme={{ accent: '#...', ... }} // maps onto the CSS custom props in index.css
/>
```

- Namespace persistent storage: `localStorage` key `vto-selected-frame`
  (catalogStore.ts) and IndexedDB DB `vto-custom-frames` (customFrames.ts)
  get a configurable prefix (default keeps current values so the demo app
  doesn't lose state).
- `window.location.reload()` in `SceneCanvas.tsx`'s context-loss toast
  becomes an overridable callback.

### 1.6 Testing & CI (~2–3 days)

- GitHub Actions: typecheck, lint, build both workspace targets, pack the
  library, install the packed tarball into a scratch Vite app and mount it
  (import smoke test).
- Manual compat matrix (recorded as a checklist in the repo): Chrome,
  Firefox, Edge, Safari desktop; iOS Safari (exercises the WebKit
  main-thread MediaPipe path in `FaceTrackerBridge.tsx`); Android Chrome.
  Portrait viewport pass on both mobiles.
- Publish workflow to the channel chosen in Phase 0.4.

### Acceptance criteria

- Fresh Vite + React 18 project: `pnpm add @yourorg/eyewear-vto` + mount at a
  **non-root base path** → working try-on, no console errors.
- Demo app (`apps/vto-demo`) unchanged in behaviour; Railway deploy green.
- Compat matrix all green; CI publishes on tag.

---

## Phase 2 — Supabase license layer

**Objective:** the SDK is inert without a valid key; you can issue, rotate,
and revoke keys with single SQL calls; billing stays manual.

### 2.1 Database (~0.5 day)

- Migrations for `licenses`, `license_checks` (see PLAN.md for columns; add
  `environment text check (environment in ('staging','production'))`).
- `issue_license(email, origins, months, plan, environment)` and
  `rotate_license(old_key)` (returns new key; sets
  `grace_until = now() + 7 days` on the old row — verify accepts either
  while grace holds).
- RLS: deny-all to anon/authenticated; Edge Function uses the service role.
- Enable PITR or nightly dumps (revenue-critical table).

### 2.2 Edge Function `/verify-license` (~1 day)

- POST `{ key }`; reads `Origin` header server-side (never trust a
  client-supplied origin field).
- Checks: key exists → status active → origin ∈ allowed_origins (exact
  scheme+host match; wildcard subdomain support optional later) →
  `expires_at > now()` (or within rotation grace).
- Rate limit: 60 checks/key/hour (count via `license_checks`), 429 +
  15-minute lockout on breach.
- Response: `{ valid, plan, expiresAt, recheckInSeconds }` (default 600).
  Failures return `{ valid: false, reason }` with reasons the SDK can
  render distinctly: `unknown_key`, `expired`, `origin_not_allowed`,
  `revoked`, `rate_limited`.
- CORS: echo the request `Origin` only when it passed the allowlist check.
- Log every check (key, origin, ip, outcome) to `license_checks`.

### 2.3 SDK license module (~1 day)

- `src/license/`: `LicenseProvider.tsx`, `LicenseRequiredCard.tsx`,
  `verifyLicense.ts`, `types.ts`.
- Gate placement: `LicenseRequiredCard` slots into the existing state
  precedence in `VtoApp.tsx` ABOVE `BrowserUnsupported` (no point asking
  for a camera if there's no license).
- Recheck loop: `setTimeout` re-armed from each response's
  `recheckInSeconds`; paused while `document.hidden`, immediate re-verify on
  `visibilitychange` → visible if the cached session is stale.
- Failure policy: 1 consecutive failure → keep running, log warning;
  2 consecutive failures → tear down to `LicenseRequiredCard`. Transient
  network errors (fetch rejection, 5xx) honour a 30-minute
  last-known-good grace; explicit denials (`revoked`, `expired`,
  `origin_not_allowed`) take effect on the SECOND consecutive denial.
- Session cache in `sessionStorage` (per-tab) so reloads don't block on
  the network.
- Verify failures surface through the `onError` beacon prop.

### 2.4 Ops (~0.5 day)

- pg_cron daily expiring-soon alert (7-day horizon) → Slack webhook/email.
- `docs/billing-runbook.md`: enquiry → payment link → `issue_license` →
  email key; rotation procedure; revocation procedure; the automation
  tripwire (10 customers or >2 hrs/week).

### Acceptance criteria

- Issue key → SDK mounts. Revoke → `LicenseRequiredCard` within
  ≤ 2 × recheck interval. Rotate → zero downtime across the grace window.
- Wrong-origin key rejected; rate limit trips at 61 calls/hour.
- Kill the network mid-session → try-on keeps running ≥ 30 minutes.

---

## Phase 3 — VisionKart integration

**Objective:** the SDK running in VisionKart staging with a real staging key,
plus an integration guide good enough for the next customer.

### Tasks

1. Install the package from the Phase-0.4 channel.
2. Mount point: if Next.js, a client component wrapping
   `dynamic(() => import('@yourorg/eyewear-vto'), { ssr: false })`; if SPA,
   plain lazy import. Place behind a user gesture (e.g. "Try on" button on a
   product page) — camera permission prompts on page load are hostile.
3. Serve the static assets (mediapipe WASM + model + GLBs) from
   VisionKart's public dir or CDN; point `assetsBaseUrl` at it. (Model is
   ~3 MB — put long cache headers on it.)
4. `pnpm why three` — assert a single Three.js copy; align versions if not.
5. CSP additions (see PLAN.md list) + `Permissions-Policy: camera=(self)`.
6. Staging license key via env var; production key only in prod config.
7. Map VisionKart's product data → `frames` prop (id, name, modelUrl,
   thumbUrl, attribution, optional fit).
8. Theme pass: map VisionKart's design tokens onto the SDK theme prop.
9. Wire `onCapture`/`onPdMeasured` into VisionKart's flows (e.g. attach the
   capture to a share sheet; store PD against the cart/prescription flow).
10. Write `docs/integration-guide.md` in the SDK repo while doing all of the
    above — the guide is the deliverable, VisionKart is its first test.

### Acceptance criteria

- Try-on works end-to-end on VisionKart staging on the full compat matrix.
- Guide reviewed by someone who didn't write it (or: you can follow it
  cold in a scratch app in < 30 minutes).

---

## Phase 4 — 2D→3D converter (`eyewear-forge`)

Fully specified in **[eyewear-forge-handoff.md](./eyewear-forge-handoff.md)**
— a standalone founding document for the new repository, including the exact
GLB contract (extracted from this codebase's real constants), pipeline
design, API, repo scaffold, spike plan, and the list of files to port from
this repo.
