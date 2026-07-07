// The rule-authoring AI. Given a denial, it proposes a new scrub rule to
// prevent that denial class. Two responders, same interface:
//
//   - stubResponder: deterministic. Reads the 835's CARC code and proposes the
//     scrub rule that would have caught it. Lets the loop run end-to-end with
//     no network. This is the default so the demo always works offline.
//   - aiResponder (optional): asks the model to reason from the denial context
//     to the right claim field. Wired to the BYOK/HF proxy; falls back to the
//     stub on any failure. (Added in the UI ship; the loop is engine-complete
//     without it.)
//
// A proposal is deliberately small: which claim field the new ACCEPTANCE_
// CRITERION must REQUIRE. The AI never writes free-form code — it fills the
// one slot the harness schema allows. That's the closed action space.

import { type CarcDef } from "./carc";
import type { Remit } from "./payer";

export interface RuleProposal {
  /** The billing field the new scrub rule will REQUIRE. */
  field: string;
  /** The CARC that motivated it. */
  carc: CarcDef;
  /** Human-readable rationale (shown in the ledger + UI). */
  rationale: string;
  /** Which responder produced it. */
  source: "stub" | "ai";
}

export type Responder = (denial: Remit) => Promise<RuleProposal | null>;

/** Deterministic responder: read the 835's CARC, propose the field that
 *  prevents it. */
export const stubResponder: Responder = async (denial) => {
  const carc: CarcDef | undefined = denial.carc;
  if (!carc) return null;
  return {
    field: carc.preventedByField,
    carc,
    rationale: `Denial ${carc.code} (${carc.description}) is prevented by requiring "${carc.preventedByField}" before submission. Proposing scrub rule: ${carc.ruleLabel}.`,
    source: "stub",
  };
};
