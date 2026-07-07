// QC runtime types
//
// Audit entry shape, event shape, harness API surface.

import type { SeverityLevel, AuditLevel, ColorTag, RecoveryAction } from '../../qc-parser/src/index.js';

// --- Event shape ---

export interface InspectionEvent {
  point: string;
  payload: Record<string, unknown>;
  timestamp: number; // ms since epoch
}

// --- Audit entries ---

export type AuditEntryKind =
  | 'inspection'
  | 'control_limit_evaluation'
  | 'defect_mode_evaluation'
  | 'acceptance_criterion_evaluation'
  | 'poka_yoke_evaluation'
  | 'spc_chart_update'
  | 'andon_firing'
  | 'recovery_execution'
  | 'ai_proposal'
  | 'operator_action'
  | 'harness_error';

export interface BaseAuditEntry {
  timestamp: number;
  kind: AuditEntryKind;
  // For the demo UI: deterministic per-entry id
  id: string;
}

export interface InspectionAuditEntry extends BaseAuditEntry {
  kind: 'inspection';
  point: string;
  payload: Record<string, unknown>;
}

export interface ControlLimitAuditEntry extends BaseAuditEntry {
  kind: 'control_limit_evaluation';
  name: string;
  point: string;
  measure: string; // dotted path
  measuredValue: number;
  upper?: number;
  lower?: number;
  violated: boolean;
}

export interface DefectModeAuditEntry extends BaseAuditEntry {
  kind: 'defect_mode_evaluation';
  name: string;
  point: string;
  severity: SeverityLevel;
  detected: boolean;
}

export interface AcceptanceCriterionAuditEntry extends BaseAuditEntry {
  kind: 'acceptance_criterion_evaluation';
  name: string;
  point: string;
  passed: boolean;
  auditIncludes?: Record<string, unknown>;
}

export interface PokaYokeAuditEntry extends BaseAuditEntry {
  kind: 'poka_yoke_evaluation';
  name: string;
  point: string;
  blocked: boolean;
  reply?: string;
  auditIncludes?: Record<string, unknown>;
}

export interface AndonFiringAuditEntry extends BaseAuditEntry {
  kind: 'andon_firing';
  name: string;
  halt: string;
  preserve: string;
  escalate: string;
  triggeredBy: string; // e.g., "CONTROL_LIMIT refund_amount"
  audit: AuditLevel;
  demoVisible: boolean;
  colorTag?: ColorTag;
}

export interface SpcChartUpdateAuditEntry extends BaseAuditEntry {
  kind: 'spc_chart_update';
  name: string;
  point: string;
  measure: string;
  measuredValue: number;
  inBaseline: boolean;
  centerLine: number | null;
  stdDev: number | null;
  ruleViolated: 'rule_1' | 'rule_2' | 'rule_5' | 'rule_6' | null;
}

export interface RecoveryAuditEntry extends BaseAuditEntry {
  kind: 'recovery_execution';
  andonName: string;
  recovery: RecoveryAction;
  customerMessage?: string;
}

export interface AiProposalAuditEntry extends BaseAuditEntry {
  kind: 'ai_proposal';
  proposalType: string;
  details: Record<string, unknown>;
}

export interface OperatorActionAuditEntry extends BaseAuditEntry {
  kind: 'operator_action';
  action: string;
  details?: Record<string, unknown>;
}

// Emitted when a rule references a named predicate or set that isn't
// registered. The runtime resolves the affected construct FAIL-CLOSED
// (block/flag rather than pass) and records this so a misconfigured
// harness is loud, not silent. `construct` is e.g. "ACCEPTANCE_CRITERION
// tool_call_valid"; `reference` is the unregistered name.
export interface HarnessErrorAuditEntry extends BaseAuditEntry {
  kind: 'harness_error';
  construct: string;
  point: string;
  reference: string;
  message: string;
  // What the runtime did about it, e.g. "blocked" / "flagged".
  resolution: string;
}

export type AuditEntry =
  | InspectionAuditEntry
  | ControlLimitAuditEntry
  | DefectModeAuditEntry
  | AcceptanceCriterionAuditEntry
  | PokaYokeAuditEntry
  | AndonFiringAuditEntry
  | SpcChartUpdateAuditEntry
  | RecoveryAuditEntry
  | AiProposalAuditEntry
  | OperatorActionAuditEntry
  | HarnessErrorAuditEntry;

// --- Emit result ---

export interface EmitResult {
  // For pre-emission inspection points / acceptance criteria / poka-yokes,
  // this signals whether the production action should proceed.
  allowed: boolean;
  // If the harness fired one or more Andons, this is the customer-facing
  // recovery message (from the first fired Andon's recovery).
  customerMessage?: string;
  // Andons fired during this emit, in firing order.
  andonsFired: string[];
}

// --- Subscription callback ---

export type AuditCallback = (entry: AuditEntry) => void;
