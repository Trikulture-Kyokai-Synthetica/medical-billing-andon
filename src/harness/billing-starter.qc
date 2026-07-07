// billing-starter.qc — the STARTER QC harness for the medical-billing andon demo.
//
// This is a real Agicore QC program, executed by the vendored qc-runtime in
// the browser. It scrubs each claim before submission. Every ACCEPTANCE_CRITERION
// is a scrub rule; when one fails, an ANDON fires and the claim is held for
// correction instead of being submitted into a denial.
//
// The harness starts deliberately THIN — it only knows a couple of rules. The
// andon loop grows it: each payer denial the scrubber failed to prevent becomes
// an AI-proposed new ACCEPTANCE_CRITERION, vetted through the tiered mutation
// pipeline (tier-verify -> sandbox regression -> deploy) before it can change
// this program. The AI_HARNESS block below is the governance boundary: the AI
// may PROPOSE tightening for human review; it may never loosen a rule, override
// an andon, or suppress an audit entry.

CONTROL_PLAN billing_scrubber_plan {
  TITLE             "Revenue-Cycle Claim Scrubber — Andon Loop Demo"
  VERSION           "0.1.0"
  DESCRIPTION       "Deterministic 837 claim scrubber that learns to prevent \
                     payer denials. Each 835 denial pulls the andon cord; the AI \
                     proposes a new scrub rule; the deterministic mutation \
                     pipeline vets it against the historical claim corpus before \
                     it deploys. Every rule change is hash-chained in the audit \
                     trail."
  PRODUCTION_SYSTEM claim_pipeline
  AUTHORITY         revenue_cycle.compliance_committee
  AUDIT_TRAIL       billing_audit
  AI_HARNESS        scrub_rule_author

  INSPECTION_POINTS {
    claim_ready_to_submit
  }
  ACCEPTANCE_CRITERIA {
    modifier_required
    prior_auth_present
  }
  ANDONS {
    would_deny_modifier
    would_deny_auth
  }
}

PRODUCTION_SYSTEM claim_pipeline {
  KIND         agicore_app
  SOURCE       "./claim_pipeline.agi"
  EVENT_BRIDGE in_process_pubsub
  MOCK         true
}

// The single inspection point: a fully-coded claim, one moment before it would
// be transmitted to the payer as an 837. Fields mirror the claim's billing-
// relevant facts (synthetic — no PHI ever).
INSPECTION_POINT claim_ready_to_submit {
  CAPTURES claim_id: string, cpt: string, payer: string, charge_usd: float,
           modifier_present: bool, prior_auth_present: bool,
           dx_supports_cpt: bool, npi_present: bool,
           charge_within_limit: bool, units: number
  SCOPE    pre-emission
}

// ── Starter scrub rules ──────────────────────────────────────────────────────
// Two rules to begin. Everything else the scrubber will LEARN from denials.

ACCEPTANCE_CRITERION modifier_required {
  POINT     claim_ready_to_submit
  REQUIRES  modifier_present
  ON_FAIL   ANDON would_deny_modifier
}

ACCEPTANCE_CRITERION prior_auth_present {
  POINT     claim_ready_to_submit
  REQUIRES  prior_auth_present
  ON_FAIL   ANDON would_deny_auth
}

// ── Andons — one per denial class the scrubber can already prevent ───────────

ANDON would_deny_modifier {
  HALT         claim_submission
  PRESERVE     claim_for_correction
  ESCALATE     coding_specialist
  RECOVERY     manual
  AUDIT        verbose
  DEMO_VISIBLE true
  COLOR_TAG    red
}

ANDON would_deny_auth {
  HALT         claim_submission
  PRESERVE     claim_for_correction
  ESCALATE     auth_team
  RECOVERY     manual
  AUDIT        verbose
  DEMO_VISIBLE true
  COLOR_TAG    orange
}

// ── AI harness — the governance boundary ─────────────────────────────────────
// What the AI is allowed to do inside this runtime. It observes denials and
// PROPOSES new scrub rules for human review. It cannot loosen, override, or
// suppress anything. This is what makes "AI everywhere" safe in a regulated
// revenue cycle: the substrate bounds the AI, not a policy memo.

AI_HARNESS scrub_rule_author {
  DESCRIPTION  "The rule-authoring AI observes payer denials at the declared \
                inspection point and proposes new acceptance criteria (scrub \
                rules) to prevent that denial class. Every proposal is human- \
                reviewable and must pass the deterministic mutation pipeline. \
                The AI cannot modify the control plan, loosen or remove a rule, \
                override an andon, or suppress an audit entry."
  PERMITTED_OBSERVATIONS {
    claim_ready_to_submit   READ_ONLY
  }
  PERMITTED_PROPOSALS {
    new_acceptance_criterion   REQUIRES human_review
    tighten_control_limit      REQUIRES human_review
  }
  FORBIDDEN_ACTIONS {
    modify_control_plan
    loosen_control_limit
    override_andon
    suppress_audit_entry
    bypass_acceptance_criterion
    bypass_poka_yoke
    grant_self_new_permissions
    take_direct_production_action_outside_acceptance_gates
  }
  PROPOSAL_REVIEW_QUEUE  scrub_rule_review
  RUNTIME_SANDBOX        deterministic
}

// ── Audit trail — the compliance-grade record ────────────────────────────────

AUDIT_TRAIL billing_audit {
  CAPTURES {
    inspection_events
    acceptance_criterion_evaluations
    andon_firings
    ai_observations
    ai_proposals
    operator_actions
    recovery_executions
  }
  STORAGE             append_only
  RETENTION           7_years
  EXPORT_FORMATS      { csv, json, signed_pdf }
  TIMESTAMP_PRECISION microsecond
  PROVENANCE_CHAIN    full
  TAMPER_EVIDENT      hash_anchored
}
