// Synthetic claim generation. No PHI — everything here is fabricated. Fields
// mirror the billing-relevant facts of an 837 claim. Each billing "fact" is a
// boolean the payer will check; a claim with a false fact is a latent denial
// until the scrubber learns to require that fact.

import { ALL_BILLING_FIELDS } from "./carc";

export interface Claim {
  claimId: string;
  cpt: string; // procedure (CPT/HCPCS)
  dx: string; // diagnosis (ICD-10)
  payer: string;
  chargeUsd: number;
  units: number;
  // Billing facts (the learnable rule surface). Snake_case mirror goes to the
  // qc-runtime; camelCase is the app-side model.
  modifierPresent: boolean;
  priorAuthPresent: boolean;
  dxSupportsCpt: boolean;
  npiPresent: boolean;
  chargeWithinLimit: boolean;
}

// A few recognizable synthetic code pairs (imaging-flavored, since the demo
// leans radiology — a nod to the SimonMed context).
const CPTS = ["70450", "72148", "73721", "74177", "71260", "70553"];
const DXS = ["R51.9", "M54.5", "S83.512A", "R10.9", "R91.8", "G44.209"];
const PAYERS = ["Aetna", "UHC", "Cigna", "BCBS", "Humana", "Medicare"];

/** Deterministic PRNG (mulberry32) so a seed reproduces a claim stream — the
 *  ledger and regression tests stay reproducible across runs. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate one synthetic claim. `cleanRate` is the per-fact probability that a
 * given billing fact is satisfied (default 0.82) — so most facts are fine and
 * a minority of claims carry a defect that will surface as a hold or a denial.
 */
export function generateClaim(rng: () => number, seq: number, cleanRate = 0.82): Claim {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const factOk = () => rng() < cleanRate;
  return {
    claimId: `CLM${String(100000 + seq).slice(-6)}`,
    cpt: pick(CPTS),
    dx: pick(DXS),
    payer: pick(PAYERS),
    chargeUsd: Math.round((300 + rng() * 2400) * 100) / 100,
    units: 1 + Math.floor(rng() * 2),
    modifierPresent: factOk(),
    priorAuthPresent: factOk(),
    dxSupportsCpt: factOk(),
    npiPresent: factOk(),
    chargeWithinLimit: factOk(),
  };
}

/** The claim as the qc-runtime sees it — snake_case field names matching the
 *  harness INSPECTION_POINT CAPTURES. */
export function toClaimPayload(c: Claim): Record<string, unknown> {
  return {
    claim_id: c.claimId,
    cpt: c.cpt,
    payer: c.payer,
    charge_usd: c.chargeUsd,
    units: c.units,
    modifier_present: c.modifierPresent,
    prior_auth_present: c.priorAuthPresent,
    dx_supports_cpt: c.dxSupportsCpt,
    npi_present: c.npiPresent,
    charge_within_limit: c.chargeWithinLimit,
  };
}

/** Map a billing field name to the claim's boolean for that fact. */
export function claimFact(c: Claim, field: string): boolean {
  const payload = toClaimPayload(c);
  return payload[field] === true;
}

/** Sanity: every billing field in the CARC table has a matching claim fact. */
export function assertFieldsCovered(): void {
  const sample = generateClaim(makeRng(1), 0);
  const payload = toClaimPayload(sample);
  for (const f of ALL_BILLING_FIELDS) {
    if (!(f in payload)) throw new Error(`billing field "${f}" has no claim fact`);
  }
}
