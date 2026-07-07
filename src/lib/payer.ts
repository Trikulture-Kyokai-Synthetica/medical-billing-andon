// The simulated payer. It holds the COMPLETE rule set — every billing fact a
// clean claim must satisfy — and adjudicates each submitted claim against it,
// returning an 835 remittance line. When a claim violates a rule, the payer
// denies it with the mapped CARC code. This is the "ground truth" the scrubber
// is learning: the gap between what the scrubber checks and what the payer
// enforces IS the denial surface, and the andon loop closes it.

import { ALL_BILLING_FIELDS, carcForField, type CarcDef } from "./carc";
import { claimFact, type Claim } from "./claim";

export type RemitStatus = "paid" | "denied";

export interface Remit {
  claimId: string;
  status: RemitStatus;
  paidUsd: number;
  /** Populated on denial: the CARC the payer returned. */
  carc?: CarcDef;
  /** The offending field, on denial. */
  field?: string;
}

/**
 * Adjudicate a submitted claim as an 835 would. Checks the payer's full rule
 * set in a fixed order; the FIRST unsatisfied fact denies the claim with that
 * field's CARC (one adjustment reason per claim, like a real CAS segment).
 */
export function adjudicate(claim: Claim): Remit {
  for (const field of ALL_BILLING_FIELDS) {
    if (!claimFact(claim, field)) {
      return {
        claimId: claim.claimId,
        status: "denied",
        paidUsd: 0,
        carc: carcForField(field),
        field,
      };
    }
  }
  return { claimId: claim.claimId, status: "paid", paidUsd: claim.chargeUsd };
}
