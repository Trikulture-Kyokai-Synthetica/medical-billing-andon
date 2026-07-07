# Revenue-Cycle Andon Loop — Medical Billing Demo

A real-world demonstration of Agicore's **ANDON LOOP** continual-harness
architecture, shaped as a medical-billing claim scrubber that **learns to
prevent payer denials**.

Each claim runs through a deterministic scrubber — the **real Agicore
`qc-runtime`**, vendored and executing an actual `.qc` harness in the browser.
A claim that passes the scrubber is submitted (an 837); the payer adjudicates
and may deny it (an 835 carrying a CARC reason code). A denial is a defect that
escaped to a downstream customer at 100x the cost — so it **pulls the andon
cord**: the AI proposes a new scrub rule, the rule flows through a deterministic
mutation pipeline (tier-verify → sandbox regression replay → deploy) before it
can change the harness, and every transition is appended to a SHA-256
hash-chained, tamper-evident audit ledger.

The scrubber starts thin and reaches parity with the payer one denial at a time.
**The denial rate falls to zero** as defects get caught at the source instead of
by the payer — the 1-10-100 rule, made visible.

Everything is **synthetic — no PHI, ever.** Names, MRNs, and NPIs are fabricated.

## Why it's faithful, not themed

- The scrubber is the real `qc-runtime` (`src/vendor/qc-runtime`, `qc-parser`),
  executing `src/harness/billing-starter.qc` — a valid Agicore QC program with a
  `CONTROL_PLAN`, an `AI_HARNESS` governance block, and a hash-anchored
  `AUDIT_TRAIL`.
- The **`AI_HARNESS` block is the compliance boundary**: the rule-authoring AI
  may *propose* new scrub rules for human review, but is *forbidden* from
  loosening a rule, overriding an andon, or suppressing an audit entry. "AI
  everywhere" is safe because the substrate bounds it — not a policy memo.
- Each payer denial maps to a real CARC code (CO-4 modifier, CO-197 auth, CO-11
  medical necessity, CO-16 missing NPI, CO-45 fee schedule). The learned rule is
  a new `ACCEPTANCE_CRITERION` that `REQUIRES` the field that prevents it.

## What you see

- The **revenue-cycle floor**: HL7 v2 charge → 837 → 835/denial → andon → rule →
  tiered vet → deploy → ledger.
- **Message panels** with recognizable synthetic segments (the CARC rides in the
  835's `CAS` segment — the segment that pulls the cord).
- A **denial-rate gauge** dropping over the session, the **live `.qc` scrub
  rules** growing as the loop learns, and the **hash-chained ledger**.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5174
```

Drive it from the UI (Next claim / Run 20 / Auto-run) or the console:

```js
demo.run(20)       // process 20 claims through the cycle
demo.metrics()     // denial rate, rules learned, held-at-source
demo.harness()     // the current .qc harness — watch it grow
demo.learned()     // the scrub rules learned from denials
demo.ledger()      // the hash-chained audit ledger
demo.verify()      // re-derive the chain and confirm it's intact
demo.reset()       // fresh loop from the starter harness
```

## Build + deploy

```bash
npm run build      # tsc --noEmit && vite build -> ./dist
npm run preview    # serve the build locally
npx wrangler deploy
```

Deploys to `medical-billing-andon.<subdomain>.workers.dev` (a Worker fronting
the SPA). The demo runs fully offline with a deterministic responder — no BYOK
token required. The `/api/babyai/*` proxy scaffolding is dormant and only used
if a live-AI responder is wired in later.
