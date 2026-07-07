// CARC / RARC — the payer's denial reason codes, and the claim fact each one
// maps to. This table is the bridge between "the payer denied it" (an 835 CAS
// segment carrying a CARC) and "the scrubber should require this field" (a new
// ACCEPTANCE_CRITERION over that field).
//
// CARC = Claim Adjustment Reason Code (the "why"); RARC = Remittance Advice
// Remark Code (the supplementary note). Group codes: CO = Contractual
// Obligation (provider write-off / can't bill patient), PR = Patient
// Responsibility. These are real, widely-seen codes; the data is synthetic.

export interface CarcDef {
  /** e.g. "CO-197". */
  code: string;
  /** Human description as it reads on an 835 / EOB. */
  description: string;
  /** Supplementary RARC note, if any. */
  rarc?: string;
  /** The claim fact (snake_case, matching the harness CAPTURES) whose truth
   *  prevents this denial. A scrub rule that REQUIRES this field catches the
   *  claim before it's ever submitted. */
  preventedByField: string;
  /** Short human label for the learned rule the AI proposes. */
  ruleLabel: string;
}

export const CARC_TABLE: CarcDef[] = [
  {
    code: "CO-4",
    description: "The procedure code is inconsistent with the modifier used, or a required modifier is missing.",
    rarc: "N519",
    preventedByField: "modifier_present",
    ruleLabel: "modifier required for this procedure",
  },
  {
    code: "CO-197",
    description: "Precertification / authorization absent.",
    rarc: "N54",
    preventedByField: "prior_auth_present",
    ruleLabel: "prior authorization required",
  },
  {
    code: "CO-11",
    description: "The diagnosis is inconsistent with the procedure.",
    rarc: "M76",
    preventedByField: "dx_supports_cpt",
    ruleLabel: "diagnosis must support the procedure (medical necessity)",
  },
  {
    code: "CO-16",
    description: "Claim/service lacks information which is needed for adjudication.",
    rarc: "N290", // missing/incomplete rendering provider NPI
    preventedByField: "npi_present",
    ruleLabel: "rendering-provider NPI required",
  },
  {
    code: "CO-45",
    description: "Charge exceeds fee schedule / maximum allowable.",
    preventedByField: "charge_within_limit",
    ruleLabel: "charge must be within the payer fee schedule",
  },
];

const BY_FIELD = new Map(CARC_TABLE.map((c) => [c.preventedByField, c]));
const BY_CODE = new Map(CARC_TABLE.map((c) => [c.code, c]));

export function carcForField(field: string): CarcDef | undefined {
  return BY_FIELD.get(field);
}
export function carcByCode(code: string): CarcDef | undefined {
  return BY_CODE.get(code);
}

/** The full set of billing facts a fully-compliant claim must satisfy — i.e.
 *  the payer's complete rule set. The scrubber starts knowing only a subset
 *  and learns the rest, one denial at a time. */
export const ALL_BILLING_FIELDS = CARC_TABLE.map((c) => c.preventedByField);
