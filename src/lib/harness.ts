// The QC-harness integration. This is where the demo touches the REAL Agicore
// runtime: the vendored qc-parser + qc-runtime, executing the billing harness
// against synthetic claims. Nothing here is themed or faked — it's the same
// runtime that ships in Agicore.

import { parse, validate } from "../vendor/qc-parser/src/index";
import { Runtime } from "../vendor/qc-runtime/src/index";
import { toClaimPayload, type Claim } from "./claim";
import { carcForField } from "./carc";

export interface BuiltHarness {
  source: string;
  runtime: Runtime;
  valid: boolean;
  errors: string[];
  warnings: number;
}

/** Parse + validate a .qc source and construct the Runtime. Throws on a hard
 *  parse error (a malformed harness should never deploy — fail closed). */
export function buildHarness(source: string): BuiltHarness {
  const file = parse(source); // throws ParseError on syntax/required-field failure
  const v = validate(file);
  const runtime = new Runtime(file);
  return {
    source,
    runtime,
    valid: v.valid,
    errors: v.errors.map((e) => e.message),
    warnings: v.warnings.length,
  };
}

export interface ScrubResult {
  /** True when the scrubber HELD the claim (an andon fired) — a defect caught
   *  at the source, before submission. False = the claim passed the scrubber. */
  held: boolean;
  andons: string[];
}

/** Run one claim through the scrubber (qc-runtime emit at the pre-submission
 *  inspection point). */
export function scrub(runtime: Runtime, claim: Claim): ScrubResult {
  const r = runtime.emit("claim_ready_to_submit", toClaimPayload(claim));
  return { held: !r.allowed, andons: r.andonsFired };
}

const COLOR_FOR_FIELD: Record<string, string> = {
  modifier_present: "red",
  prior_auth_present: "orange",
  dx_supports_cpt: "yellow",
  npi_present: "blue",
  charge_within_limit: "green",
};

/** The .qc text for a learned rule: a new ACCEPTANCE_CRITERION that REQUIRES
 *  the field, plus the ANDON it fires. This is exactly what the AI proposes
 *  and the mutation pipeline deploys. */
export function criterionSourceFor(field: string): string {
  const color = COLOR_FOR_FIELD[field] ?? "yellow";
  const carc = carcForField(field);
  const note = carc ? `  // learned from denial ${carc.code} — ${carc.ruleLabel}` : "";
  return `
ACCEPTANCE_CRITERION learned_${field} {${note}
  POINT     claim_ready_to_submit
  REQUIRES  ${field}
  ON_FAIL   ANDON would_deny_${field}
}

ANDON would_deny_${field} {
  HALT         claim_submission
  PRESERVE     claim_for_correction
  ESCALATE     billing_review
  RECOVERY     manual
  AUDIT        verbose
  DEMO_VISIBLE  true
  COLOR_TAG    ${color}
}
`;
}

/** Append a learned criterion to a harness source. Declaration order doesn't
 *  matter (references resolve at validate time), so we append at the end. */
export function appendCriterion(source: string, field: string): string {
  return source.trimEnd() + "\n" + criterionSourceFor(field) + "\n";
}

export interface RegressionResult {
  /** True if the candidate harness now HOLDS the claim that was denied. */
  fixesDenial: boolean;
  /** Previously-clean (paid) claims the candidate would now falsely hold. */
  regressions: Claim[];
  /** How many corpus claims were replayed. */
  replayed: number;
}

/**
 * The deterministic sandbox test. Build the candidate harness (with the
 * proposed rule) and replay it: (1) does it now hold the claim that was
 * denied? (2) does it hold any previously-paid claim it shouldn't (a
 * regression)? A proposal deploys only if it fixes the denial with zero
 * regressions.
 */
export function regressionReplay(
  candidateSource: string,
  deniedClaim: Claim,
  paidCorpus: Claim[],
): RegressionResult {
  const candidate = buildHarness(candidateSource);
  const fixesDenial = scrub(candidate.runtime, deniedClaim).held;
  const regressions: Claim[] = [];
  for (const c of paidCorpus) {
    if (scrub(candidate.runtime, c).held) regressions.push(c);
  }
  return { fixesDenial, regressions, replayed: paidCorpus.length };
}
