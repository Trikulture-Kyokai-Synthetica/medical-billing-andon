// The andon loop for medical billing. One tick = one claim through the whole
// revenue cycle:
//
//   generate -> SCRUB (qc-runtime) -> [held? correct at source, done]
//            -> SUBMIT (837) -> ADJUDICATE (835) -> [paid? done]
//            -> DENIED (CARC) -> pull the andon cord
//            -> AI proposes a scrub rule
//            -> tier-verify -> sandbox regression replay -> DEPLOY
//            -> the harness grows; that denial class can never recur
//
// Every transition is hash-chained into the ledger. The scrubber starts thin
// and reaches parity with the payer one denial at a time — so the denial rate
// falls to zero as defects get caught at the source (cost 1) instead of by the
// payer (cost 100).

import { adjudicate, type Remit } from "./payer";
import { generateClaim, makeRng, type Claim } from "./claim";
import { ALL_BILLING_FIELDS } from "./carc";
import { Ledger } from "./ledger";
import { stubResponder, type Responder, type RuleProposal } from "./responder";
import {
  appendCriterion,
  buildHarness,
  regressionReplay,
  scrub,
  type BuiltHarness,
} from "./harness";

// The starter fields the scrubber already checks (from billing-starter.qc).
const STARTER_FIELDS = ["modifier_present", "prior_auth_present"];

export interface LoopMetrics {
  processed: number;
  held: number; // caught pre-submission
  submitted: number;
  paid: number;
  denied: number;
  deniedByCarc: Record<string, number>;
  rulesLearned: number;
  rejectedProposals: number;
}

export type TickStage =
  | "held"
  | "paid"
  | "denied_deployed"
  | "denied_tier_rejected"
  | "denied_sandbox_rejected"
  | "denied_known";

export interface TickResult {
  claim: Claim;
  stage: TickStage;
  andons?: string[];
  remit?: Remit;
  proposal?: RuleProposal;
}

export class BillingLoop {
  private harnessSource: string;
  private built: BuiltHarness;
  private knownFields: Set<string>;
  private ledger = new Ledger();
  private paidCorpus: Claim[] = [];
  private seq = 0;
  private clock = 0; // deterministic monotonic timestamp (no wall-clock -> reproducible)
  private rng: () => number;
  private responder: Responder;
  metrics: LoopMetrics = {
    processed: 0, held: 0, submitted: 0, paid: 0, denied: 0,
    deniedByCarc: {}, rulesLearned: 0, rejectedProposals: 0,
  };
  private listeners = new Set<() => void>();

  constructor(starterSource: string, opts?: { seed?: number; responder?: Responder }) {
    this.harnessSource = starterSource;
    this.built = buildHarness(starterSource);
    this.knownFields = new Set(STARTER_FIELDS);
    this.rng = makeRng(opts?.seed ?? 1);
    this.responder = opts?.responder ?? stubResponder;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { for (const l of this.listeners) l(); }
  private now() { return (this.clock += 1); }

  get source() { return this.harnessSource; }
  get built_() { return this.built; }
  ledgerEntries() { return this.ledger.all(); }
  verifyLedger() { return this.ledger.verify(); }
  learnedFields() { return [...this.knownFields].filter((f) => !STARTER_FIELDS.includes(f)); }

  /** Overall denial rate among SUBMITTED claims — the headline metric. */
  denialRate(): number {
    return this.metrics.submitted === 0 ? 0 : this.metrics.denied / this.metrics.submitted;
  }

  async tick(): Promise<TickResult> {
    const claim = generateClaim(this.rng, this.seq++);
    this.metrics.processed++;

    // 1. Scrub — the qc-runtime evaluates the claim against the live harness.
    const s = scrub(this.built.runtime, claim);
    if (s.held) {
      this.metrics.held++;
      await this.ledger.append("claim_held", this.now(), { claimId: claim.claimId, andons: s.andons });
      this.emit();
      return { claim, stage: "held", andons: s.andons };
    }

    // 2. Submit (837).
    this.metrics.submitted++;
    await this.ledger.append("claim_submitted", this.now(), { claimId: claim.claimId, cpt: claim.cpt, payer: claim.payer });

    // 3. Adjudicate (835).
    const remit = adjudicate(claim);
    if (remit.status === "paid") {
      this.metrics.paid++;
      this.paidCorpus.push(claim);
      await this.ledger.append("claim_paid", this.now(), { claimId: claim.claimId, paidUsd: remit.paidUsd });
      this.emit();
      return { claim, stage: "paid", remit };
    }

    // 4. Denied — the defect escaped. Pull the cord.
    const carc = remit.carc!;
    this.metrics.denied++;
    this.metrics.deniedByCarc[carc.code] = (this.metrics.deniedByCarc[carc.code] ?? 0) + 1;
    await this.ledger.append("claim_denied", this.now(), { claimId: claim.claimId, carc: carc.code, field: remit.field });
    await this.ledger.append("andon_pulled", this.now(), { claimId: claim.claimId, reason: carc.code });

    // 5. Propose a scrub rule.
    const proposal = await this.responder(remit);
    if (!proposal || this.knownFields.has(proposal.field)) {
      this.emit();
      return { claim, stage: "denied_known", remit };
    }
    await this.ledger.append("proposal", this.now(), { field: proposal.field, carc: carc.code, source: proposal.source, rationale: proposal.rationale });

    // 6. Tier-verify: a valid tightening requires a field the harness can
    //    actually observe (in CAPTURES) and doesn't already require. Rejects a
    //    proposal over an unobservable field — the closed-action-space gate.
    const tierOk = ALL_BILLING_FIELDS.includes(proposal.field) && !this.knownFields.has(proposal.field);
    if (!tierOk) {
      this.metrics.rejectedProposals++;
      await this.ledger.append("tier_rejected", this.now(), { field: proposal.field, reason: "not an observable tightening" });
      this.emit();
      return { claim, stage: "denied_tier_rejected", remit, proposal };
    }
    await this.ledger.append("tier_verified", this.now(), { field: proposal.field });

    // 7. Sandbox regression replay through the qc-runtime.
    const candidateSource = appendCriterion(this.harnessSource, proposal.field);
    const rr = regressionReplay(candidateSource, claim, this.paidCorpus);
    if (!rr.fixesDenial || rr.regressions.length > 0) {
      this.metrics.rejectedProposals++;
      await this.ledger.append("sandbox_rejected", this.now(), {
        field: proposal.field, fixesDenial: rr.fixesDenial, regressions: rr.regressions.length, replayed: rr.replayed,
      });
      this.emit();
      return { claim, stage: "denied_sandbox_rejected", remit, proposal };
    }
    await this.ledger.append("sandbox_passed", this.now(), { field: proposal.field, replayed: rr.replayed });

    // 8. Deploy — the harness grows. Rebuild the live runtime.
    this.harnessSource = candidateSource;
    this.built = buildHarness(candidateSource);
    this.knownFields.add(proposal.field);
    this.metrics.rulesLearned++;
    await this.ledger.append("deployed", this.now(), { field: proposal.field, criterion: `learned_${proposal.field}`, carc: carc.code });
    this.emit();
    return { claim, stage: "denied_deployed", remit, proposal };
  }

  async run(n: number): Promise<TickResult[]> {
    const out: TickResult[] = [];
    for (let i = 0; i < n; i++) out.push(await this.tick());
    return out;
  }
}
