// Authoring-time analysis of the live harness.
//
// The andon loop's mutation pipeline vets a proposed rule by REPLAY: does it
// fix the denial, and does it break any claim in the paid corpus? That is an
// empirical test, and it is bounded by what the corpus happens to contain.
//
// This runs the other kind of check — the compiler kind. It reads the rule set
// as logic and asks what can pass, without running a single claim. The two find
// different bugs, and the difference is the whole point:
//
//   replay   → "no claim I have ever seen breaks"
//   analysis → "no claim that could ever exist is silently impossible"
//
// A rule pair that only conflicts for multi-unit claims deploys clean through
// replay when the corpus is all single-unit claims. Analysis catches it before
// it ships, because it doesn't need an example.

import { parse, analyze, type PointAnalysis } from "../vendor/qc-parser/src/index";

export interface HarnessAnalysis {
  /** False when some inspection point can admit nothing at all. */
  ok: boolean;
  point: PointAnalysis | null;
  /** Classes excluded by the interaction of several rules — nobody decided these. */
  emergent: PointAnalysis["deadClasses"];
  /** Classes excluded by a single rule — that rule working as designed. */
  intentional: PointAnalysis["deadClasses"];
  /** Predicates backed by registered code, invisible to static analysis. */
  opaque: string[];
  error?: string;
}

export function analyzeHarness(source: string): HarnessAnalysis {
  try {
    const result = analyze(parse(source));
    const point = result.points[0] ?? null;
    const dead = point?.deadClasses ?? [];
    return {
      ok: result.ok,
      point,
      emergent: dead.filter((d) => d.emergent),
      intentional: dead.filter((d) => !d.emergent),
      opaque: result.opaqueAtoms.map((a) => a.label),
    };
  } catch (e) {
    return {
      ok: false, point: null, emergent: [], intentional: [], opaque: [],
      error: (e as Error).message,
    };
  }
}

/**
 * The two rules from the demo's "what replay misses" button.
 *
 * Each is defensible on its own and would pass review. High-complexity work
 * (multiple units) needs a modifier to justify it; the payer's multi-unit
 * policy rejects claims that carry one. Different authors, months apart.
 *
 * Together they mean no claim with units >= 2 can ever be submitted again —
 * and a corpus of single-unit claims will replay both of them clean.
 */
export const CONFLICTING_PAIR = `
ACCEPTANCE_CRITERION high_complexity_needs_modifier {
  POINT     claim_ready_to_submit
  REQUIRES  units < 2 OR modifier_present
  ON_FAIL   ANDON would_deny_modifier
}

ACCEPTANCE_CRITERION multiunit_forbids_modifier {
  POINT     claim_ready_to_submit
  REQUIRES  units < 2 OR NOT modifier_present
  ON_FAIL   ANDON would_deny_modifier
}
`;
