# eyewearVTO — Productization Plan

**Status:** draft for review · **Last updated:** 2026-07-02

This document consolidates the plan to turn the eyewearVTO prototype into two
sellable products, plus their integration into VisionKart:

1. **`@yourorg/eyewear-vto`** — the virtual try-on SDK, sold on subscription,
   license-gated via Supabase, embedded by customer sites (first: VisionKart).
2. **The converter** (working name `eyewear-forge`) — a 2D-photo → 3D-GLB
   conversion engine for onboarding frame catalogs. Separate repository,
   separate product, one-time cost per SKU.

The two products connect only through a **shared GLB contract** (frames in
storage + a versioned spec), never through shared code.

---

## Current state (what exists today)

- A self-contained React 18 + Vite SPA under `app/`, with all VTO logic in
  `app/src/vto/` (~95% ready to be extracted as a package).
- MediaPipe FaceLandmarker (self-hosted WASM + model, worker-based with a
  main-thread WebKit fallback), Three.js/R3F rendering, Zustand state,
  Tailwind styling.
- Static frame catalog (`frames.json` + GLBs in `public/glasses/`), user GLB
  uploads persisted to IndexedDB, photo capture, PD measurement.
- Procedural GLB generation in `app/scripts/generate-catalog.mjs` — this
  becomes the core of the converter (see Phase 4).
- **No** backend, tests, CI, licensing, telemetry, or docs site.

---

## Phase 0 — Decisions & reconnaissance *(≈ half day, no code)*

Blockers for later phases. Decide and record answers here.

| # | Decision | Options / notes | Answer |
|---|----------|-----------------|--------|
| 0.1 | VisionKart stack verified | Add repo to session scope; confirm React version, bundler, SSR, Tailwind, existing Three.js, CSP | ☐ |
| 0.2 | Free tier vs. hard gate | Recommend: hard-fail with `LicenseRequiredCard`; trial = time-boxed key | ☐ |
| 0.3 | License backend host | Recommend: Supabase Edge Functions (v1) | ☐ |
| 0.4 | **SDK distribution channel** | Public npm (weak gate) vs. private registry / GitHub Packages w/ per-customer tokens (recommended) vs. hosted script bundle | ☐ |
| 0.5 | **Keys per environment** | Recommend: separate staging + production keys per customer; localhost origins allowed on staging keys only | ☐ |
| 0.6 | **Trial policy** | Recommend: 14-day trial keys (`expires_at = now() + 14 days`), same schema, no code | ☐ |
| 0.7 | Converter repo name + language mix | Recommend: separate repo; Python CV service + Node/three.js generator | ☐ |

---

## Phase 1 — VTO plugin extraction *(≈ 5 days + 2–3 days testing)*

**Goal:** `pnpm add @yourorg/eyewear-vto` in any React 18 host renders a
working try-on.

- Monorepo restructure: `packages/eyewear-vto` (library),
  `apps/vto-demo` (current standalone app, kept as the Railway demo/marketing
  site).
- Vite **library mode**: emit ESM + `.d.ts`. `react`, `react-dom`, `three`,
  `@react-three/fiber`, `@react-three/drei` become `peerDependencies`
  (Three.js must be a single instance in any host bundle).
- Public API: one `<EyewearVTO>` component —
  `frames`, `assetsBaseUrl`, `licenseKey`, `onCapture`, `onPdMeasured`,
  theme overrides, optional error-beacon callback.
- Parameterize hardcoded asset paths:
  `src/vto/lib/mediapipe.ts` (`WASM_PATH`, `MODEL_PATH`) and the
  `frames.json` catalog become prop/config-driven.
- Replace the Vite-only worker import (`?worker` in
  `src/vto/lib/faceWorkerClient.ts`) with portable
  `new Worker(new URL(...), { type: 'module' })`.
- Style scoping: Tailwind `prefix: 'vto-'`, ship one compiled stylesheet,
  drop global `html, body` rules from `index.css`.
- Namespace storage: `localStorage` keys and the IndexedDB database name.
- `<Header>`/`<Footer>` become opt-in; toast + WebGL-context-loss handling
  overridable by the host.
- Move `src/lib/ReleaseGLContext.tsx` into the package.

**Testing & QA (added after gap review):**
- Browser/device compatibility matrix, verified by hand:
  Chrome/Edge/Firefox desktop, Safari desktop, iOS Safari (main-thread
  MediaPipe fallback path), Android Chrome. Portrait/mobile viewport pass.
- Smoke tests for mount/unmount, camera lifecycle, frame switching.
- CI workflow (GitHub Actions): typecheck, lint, build, package publish.

**Exit criteria:** package installs and renders in a fresh React 18 + Vite
host at a non-root base path; compat matrix green.

---

## Phase 2 — Supabase license layer *(≈ 3 days + hardening)*

**Goal:** SDK refuses to run without a valid key; revocation takes effect
within one recheck interval. Billing stays **manual** (no Stripe/Razorpay
integration yet — payments collected via payment links / UPI, licenses
managed by hand in Supabase Studio).

**Backend:**
- `licenses` table: `key`, `customer_email`, `customer_name`, `plan`,
  `status`, `allowed_origins[]`, `environment` (staging/production),
  `expires_at`, `notes` (manual payment references), `created_at`.
- `license_checks` audit table (key, origin, ip, checked_at).
- `issue_license(email, origins, months, plan, environment)` SQL helper —
  the entire manual-billing workflow is one `select`.
- Edge Function `/verify-license`: validates key + `Origin` header against
  the allowlist, rate-limits (**60 checks/key/hour**, temporary lockout on
  abuse), logs the check, returns
  `{ valid, plan, expiresAt, recheckInSeconds }`.
- RLS locked to service role only.
- pg_cron daily job: alert (Slack/email) for licenses expiring within 7 days.
- **Key rotation flow** (added after gap review): `rotate_license(key)` issues
  a replacement key and keeps the old key valid for a 7-day grace period —
  needed because keys are visible in customer page source and will leak.

**SDK:**
- `src/vto/license/` module: `LicenseProvider` (context + recheck loop),
  `LicenseRequiredCard` (joins the existing UX-state precedence alongside
  `BrowserUnsupported`), `verifyLicense.ts`.
- Recheck loop: server-driven interval (default 10 min),
  `visibilitychange`-aware, one failure = warn, two consecutive failures =
  revoke, ~30 min cached-session grace for transient outages. Never interrupt
  an in-progress try-on on a single network blip.
- Verify-failure logging server-side + optional client error beacon so *we*
  see broken customer embeds before they email us.

**Manual-billing discipline:**
- 1-page runbook: enquiry → payment link → `issue_license(...)` → email key.
- Automation tripwire: **10 active customers OR >2 hrs/week on billing** →
  build Stripe/Razorpay integration.

**Exit criteria:** revoked key → `LicenseRequiredCard` within 10 minutes;
rotated key → old key still works during grace; rate limit enforced.

---

## Phase 3 — VisionKart integration *(≈ 2–3 days, gated on 0.1)*

- If Next.js: mount via `dynamic(() => import('@yourorg/eyewear-vto'),
  { ssr: false })` — the SDK touches WebGL, `getUserMedia`, IndexedDB, and
  Workers, none of which exist server-side.
- Verify single Three.js instance (`pnpm why three`).
- CSP additions on the embedding page:
  `script-src 'wasm-unsafe-eval'`, `worker-src 'self' blob:`,
  `media-src 'self' blob:`, `connect-src https://*.supabase.co`,
  `Permissions-Policy: camera=(self)`.
- License key from env/config, never hardcoded; staging key on staging.
- Theme tokens so the VTO matches VisionKart's design system.
- Wire `onCapture` / session callbacks into VisionKart analytics if present.

**Docs deliverable (added after gap review):** integration guide covering
install, CSP requirements, SSR wrapper, license key setup, and a runnable
sample app. Docs are part of this phase's exit criteria, not an afterthought.

**Exit criteria:** end-to-end happy path on VisionKart staging with a real
issued key; integration guide good enough that a stranger could repeat it.

---

## Phase 4 — 2D→3D converter (`eyewear-forge`) *(spike 3–4 days, then ≈ 2–3 weeks)*

**Revised after architecture review: parametric-first, not generic ML.**

### Why not generic image-to-3D ML (TripoSR / Stable Fast 3D / TRELLIS / Meshy)

Glasses are near worst-case input for single-image mesh generation: thin rims
and temples get blobbed or dropped, transparent lenses confuse the models,
symmetry errors that are invisible on a generated chair look broken on a
face, the unseen back half is hallucinated, and every output needs a heavy
normalization pipeline (re-orient, re-scale to 140 mm, re-origin, split lens
vs. frame materials for the tint system) applied to a mesh that started out
bad.

### The parametric approach

Eyewear is a parametric object family, and this repo already contains a
working parametric generator (`app/scripts/generate-catalog.mjs`) that emits
convention-perfect GLBs. So: **extract parameters from the photo and drive a
generator** — every output GLB is *born* conforming; no normalization
pipeline exists at all.

```
photo → [1] segment frame from background   (rembg / SAM — commodity CV)
      → [2] extract lens silhouettes        (contour detection, OpenCV)
      → [3] measure proportions             (lens w/h, bridge, rim thickness)
      → [4] classify style + materials      (acetate/metal, rim type, colors —
                                             small classifier or one VLM call)
      → [5] drive procedural generator      (generate-catalog.mjs generalized
                                             from 8 presets to arbitrary
                                             contours + parameters)
      → [6] validate + emit GLB             (width/origin/naming asserts)
```

- Steps 1–3: deterministic, milliseconds, **no GPU**.
- Step 4 is the only ML and it's cheap at catalog-onboarding volumes.
- **Temples are templated, not extracted** (front photos don't show them;
  they're mostly occluded in the VTO anyway). 3–4 temple templates chosen by
  style classification.
- ML's future role: texture-projecting the photo onto the parametric mesh
  (v1.5), tortoiseshell/translucency, unusual sculptural frames — an
  enhancement later, not the foundation.

### Sub-phases

- **4a. Spike (3–4 days — go/no-go gate, do before committing to 4b):**
  10 real frame photos → segmentation + contour extraction → hand-feed
  parameters into a lightly-modified `generate-catalog.mjs` → load results in
  the VTO. As a control, run the same 10 photos through Meshy's API (~$2)
  to see the ML alternative's quality first-hand.
- **4b. Service (~1–1.5 weeks):** `POST /convert` → `job_id`;
  `GET /jobs/{id}` → status + signed GLB URL. Output to Supabase Storage +
  a `frames` row. Queue can be in-process at v1.
- **4c. Merchant dashboard (~1 week):** upload photos, watch progress,
  **preview + approve/reject** each GLB (this human gate converts "pipeline
  must be perfect" into "pipeline must usually be approvable"), manage
  catalog. Shares the Supabase project/auth with licensing.
- **4d. VTO catalog integration (~2 days):** optional `merchantId` prop →
  SDK fetches its catalog from Supabase instead of a bundled/prop-supplied
  list. Backward compatible.

### Repository

Separate repo (different language mix, deploy target, release cadence, and
it's separately sellable):

```
eyewear-forge/
├── service/            # FastAPI: api/, pipeline/ (segment, contours,
│                       #   classify), worker/
├── generator/          # Node + three.js, evolved from generate-catalog.mjs:
│                       #   buildFrame.ts, temples/, validate.ts
├── spec/
│   └── frame-glb-spec.md   # THE contract (see below)
└── golden/             # input photos + approved GLBs (regression suite)
```

### The shared GLB contract

The one thing shared between repos — as a **versioned spec, not code**.
Extract the conventions currently implicit in `generate-catalog.mjs` and
`glbAnalyzer.ts` into `frame-glb-spec.md` + a JSON schema + a tiny validator:

- Origin at nose-bridge contact point; +Z forward, +Y up, +X model-right.
- Temple-to-temple width = 0.14 m (140 mm).
- Lens meshes identifiable by naming convention (required by the tint system
  in `GlassesSwap.tsx`).
- `GlassesFit` parameter shape (matches `glbAnalyzer.ts`).

Converter output and VTO input both validate against the spec; the two
products evolve independently.

**Economics note:** conversion is a one-time cost per SKU, amortized forever.
A partially-manual pipeline (auto-extract → human approves) is commercially
fine at v1; price per-SKU or per-month independently of the VTO.

---

## Cross-cutting workstreams (from the gap review)

These don't belong to one phase; they gate the first sale.

| Item | When | Notes |
|------|------|-------|
| **EULA + ToS + privacy note** | Before invoice #1 | Key selling point to document: MediaPipe runs fully in-browser, **no face data ever leaves the device** — customers' lawyers will ask (GDPR / India DPDP treat face geometry as sensitive). EULA is the legal anti-redistribution protection; the key check is only technical. Merchant-upload IP indemnity clause for Phase 4. |
| **Versioning & releases** | Phase 1 | Semver, changelog, support window for old versions, CI publish pipeline. |
| **Support policy** | Before invoice #1 | Even informal: channel, response time, no-SLA statement for v1. |
| **Supabase backups** | Phase 2 | PITR or scheduled dumps — the `licenses` table is revenue-critical. |
| **Error visibility** | Phase 2 | Server-side verify-failure logs + optional SDK error beacon. |
| **Attribution check** | Phase 1 | Current GLBs are CC0/self-generated, so stripping Footer/AttributionModal in SDK mode is fine; re-check if CC-BY assets ever ship. |

---

## Timeline & dependencies

| Phase | Duration | Ships alone? | Depends on |
|-------|----------|--------------|------------|
| 0 | 0.5 day | — | — |
| 1 | 5 days + 2–3 days QA | Yes | 0 |
| 2 | 3 days + hardening | Yes | 1 |
| 3 | 2–3 days | Yes | 1 (0.1 for specifics; 2 optional) |
| 4a spike | 3–4 days | go/no-go gate | none — parallelizable |
| 4b–4d | 2.5–3.5 weeks | Yes | 4a pass; 2 for shared Supabase |

- **To first revenue (Phases 0–3):** ≈ 2.5–3 weeks.
- **To converter MVP:** +3–4 weeks after a passing 4a spike.
- Phase 4 is fully parallelizable with 1–3 (different codebase).

## Top risks

1. **VisionKart stack unknown** (0.1) — retire in Phase 0 before any Phase 1
   API decisions harden.
2. **4a spike fails** — i.e. parametric output looks toy-like on real
   branded frames. Mitigation: texture projection from the photo; fallback:
   Meshy-API hybrid. The spike exists to find this out for ~4 days' cost.
3. **Three.js double-bundling in the host** — silent breakage;
   `pnpm why three` check is part of the Phase 3 checklist.
4. **Manual billing drift** — tripwire: 10 customers or 2 hrs/week.
5. **Key leakage** — keys are public in page source by design; origin
   allowlist + rotation flow are the mitigations, both in Phase 2 scope.
