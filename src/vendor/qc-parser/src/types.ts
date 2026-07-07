// Agicore QC Dialect — Abstract Syntax Tree Type Definitions
//
// The .qc dialect declares QC harness programs. See agicore/dsl/qc-grammar.md
// for the formal grammar specification. This file is the TypeScript codification
// of that grammar.

// --- Source Location (for error reporting) ---

export interface SourceLocation {
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

// --- Primitive types inherited from .agi ---

export type QcPrimitiveType =
  | 'string'
  | 'number'
  | 'float'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'json'
  | 'id';

// --- Dialect-specific value types ---

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ChartType = 'xbar' | 'r' | 's' | 'p' | 'c' | 'u' | 'i' | 'mr';

export type WesternElectricRuleSet = 'rules_1_2' | 'rules_1_2_5_6' | 'all' | 'none';

export type ColorTag = 'red' | 'orange' | 'yellow' | 'blue' | 'green' | 'gray';

export type Scope = 'customer-facing' | 'internal' | 'pre-emission' | 'post-emission';

export type StorageMode = 'append_only' | 'replicated' | 'distributed';

export type ExportFormat = 'csv' | 'json' | 'parquet' | 'signed_pdf';

export type TimestampPrecision = 'millisecond' | 'microsecond' | 'nanosecond';

export type ProvenanceChainMode = 'none' | 'parent_link' | 'full';

export type TamperEvidentMode = 'none' | 'hash_anchored' | 'blockchain_anchored';

export type SandboxMode = 'deterministic' | 'hermetic' | 'sandboxed';

export type AuditLevel = 'verbose' | 'standard' | 'minimal';

export type AccessLevel = 'READ_ONLY' | 'READ_AGGREGATE';

export type SystemKind =
  | 'agicore_app'
  | 'http_service'
  | 'rust_binary'
  | 'python_service'
  | 'mock';

export type EventBridgeKind =
  | 'in_process_pubsub'
  | 'nats'
  | 'kafka'
  | 'redis_streams';

export type CaptureClass =
  | 'inspection_events'
  | 'control_limit_evaluations'
  | 'defect_mode_evaluations'
  | 'acceptance_criterion_evaluations'
  | 'poka_yoke_evaluations'
  | 'spc_chart_state'
  | 'andon_firings'
  | 'ai_observations'
  | 'ai_proposals'
  | 'operator_actions'
  | 'recovery_executions';

// --- Duration ---

export interface Duration {
  value: number;
  unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'months' | 'years';
}

// --- Predicate Language AST ---
//
// Predicates appear in WHEN, DETECTS, REQUIRES, and BLOCKS contexts.
// They are pure boolean expressions over inspection-point payload fields
// and named reference values. Not Turing-complete.

export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export interface FieldPath {
  kind: 'field_path';
  segments: string[]; // e.g., ['parameters', 'amount_usd']
}

export interface IdentifierRef {
  kind: 'identifier';
  name: string;
}

export interface LiteralValue {
  kind: 'literal';
  value: string | number | boolean | null;
  type: 'string' | 'number' | 'float' | 'bool' | 'null';
}

export interface ComparisonPredicate {
  kind: 'comparison';
  op: ComparisonOp;
  left: PredicateExpr;
  right: PredicateExpr;
}

export interface MembershipPredicate {
  kind: 'membership';
  negate: boolean; // true for NOT IN
  value: PredicateExpr;
  set: IdentifierRef;
}

export interface NullCheckPredicate {
  kind: 'null_check';
  expr: PredicateExpr;
  isNull: boolean; // true for IS_NULL, false for IS_NOT_NULL
}

export interface ContainsPredicate {
  kind: 'contains';
  // CONTAINS_SSN, CONTAINS_FULL_ADDRESS, etc. Extensible registry.
  predicateName: string;
  // Optional "NOT MATCHING <identifier>" tail (e.g., CONTAINS_FULL_ADDRESS NOT MATCHING current_customer)
  notMatching?: IdentifierRef;
  subject: PredicateExpr;
}

export interface MatchesPredicate {
  kind: 'matches';
  subject: PredicateExpr;
  pattern: IdentifierRef | LiteralValue;
}

export interface BooleanCombinator {
  kind: 'boolean';
  op: 'AND' | 'OR' | 'NOT';
  operands: PredicateExpr[];
}

export interface ParenthesizedPredicate {
  kind: 'parenthesized';
  inner: PredicateExpr;
}

export type PredicateExpr =
  | ComparisonPredicate
  | MembershipPredicate
  | NullCheckPredicate
  | ContainsPredicate
  | MatchesPredicate
  | BooleanCombinator
  | ParenthesizedPredicate
  | FieldPath
  | IdentifierRef
  | LiteralValue;

// --- Action references (used by ON_VIOLATION, ON_DETECT, ON_FAIL, etc.) ---

export interface AndonRef {
  kind: 'andon_ref';
  andonName: string;
}

export interface ProposeReviewRef {
  kind: 'propose_review';
  target: IdentifierRef;
}

export type TriggerAction = AndonRef | ProposeReviewRef;

// --- Recovery actions inside ANDON ---

export interface GracefulFallback {
  kind: 'graceful_fallback';
  message: string;
}

export interface RetryWithValidTool {
  kind: 'retry_with_valid_tool';
  ifCondition: PredicateExpr;
  elseAction: RecoveryAction;
}

export interface RouteToDefaultHumanQueue {
  kind: 'route_to_default_human_queue';
}

export interface ManualRecovery {
  kind: 'manual';
}

export interface CustomRecovery {
  kind: 'custom';
  name: string;
}

export type RecoveryAction =
  | GracefulFallback
  | RetryWithValidTool
  | RouteToDefaultHumanQueue
  | ManualRecovery
  | CustomRecovery;

// --- Capture field schema (for INSPECTION_POINT) ---

export interface CaptureField {
  name: string;
  type: QcPrimitiveType;
  location: SourceSpan;
}

// =============================================================================
// DECLARATION TYPES
// =============================================================================

// --- CONTROL_PLAN ---

export interface ControlPlanEnumeration {
  kind:
    | 'INSPECTION_POINTS'
    | 'CONTROL_LIMITS'
    | 'SPC_CHARTS'
    | 'DEFECT_MODES'
    | 'ACCEPTANCE_CRITERIA'
    | 'POKA_YOKES'
    | 'ANDONS';
  members: string[];
}

export interface ControlPlanDecl {
  kind: 'CONTROL_PLAN';
  name: string;
  title: string;
  version: string;
  description: string;
  productionSystem: string; // identifier ref
  authority: string; // dotted identifier (e.g., "parish.compliance")
  enumerations: ControlPlanEnumeration[];
  auditTrail: string; // identifier ref
  aiHarness: string; // identifier ref
  location: SourceSpan;
}

// --- INSPECTION_POINT ---

export interface InspectionPointDecl {
  kind: 'INSPECTION_POINT';
  name: string;
  captures: CaptureField[];
  scope: Scope;
  streamsTo?: string;
  location: SourceSpan;
}

// --- CONTROL_LIMIT ---

export interface ControlLimitDecl {
  kind: 'CONTROL_LIMIT';
  name: string;
  point: string; // inspection point identifier
  when?: PredicateExpr;
  measure: FieldPath;
  upper?: number;
  lower?: number;
  onViolation: TriggerAction;
  auditVerbose: boolean;
  location: SourceSpan;
}

// --- SPC_CHART ---

export interface SpcChartDecl {
  kind: 'SPC_CHART';
  name: string;
  point: string;
  when?: PredicateExpr;
  measure: FieldPath;
  chartType: ChartType;
  sampleSize: number;
  westernElectric: WesternElectricRuleSet;
  onRuleViolation: TriggerAction;
  audit: boolean;
  location: SourceSpan;
}

// --- DEFECT_MODE ---

export interface DefectModeDecl {
  kind: 'DEFECT_MODE';
  name: string;
  point: string;
  detects: PredicateExpr;
  severity: SeverityLevel;
  onDetect: TriggerAction;
  location: SourceSpan;
}

// --- ACCEPTANCE_CRITERION ---

export interface AcceptanceCriterionDecl {
  kind: 'ACCEPTANCE_CRITERION';
  name: string;
  point: string;
  requires: PredicateExpr;
  onFail: TriggerAction;
  auditIncludes: string[];
  location: SourceSpan;
}

// --- POKA_YOKE ---

export interface PokaYokeDecl {
  kind: 'POKA_YOKE';
  name: string;
  blocks: string; // inspection point identifier
  when: PredicateExpr;
  reply: string;
  audit: boolean;
  auditIncludes: string[];
  location: SourceSpan;
}

// --- ANDON ---

export interface AndonDecl {
  kind: 'ANDON';
  name: string;
  halt: string; // halt target (agent_pipeline, response_emission, etc.)
  preserve: string; // preservation target
  escalate: string; // escalation target
  recovery: RecoveryAction;
  audit: AuditLevel;
  demoVisible: boolean;
  colorTag?: ColorTag;
  location: SourceSpan;
}

// --- AI_HARNESS ---

export interface PermittedObservation {
  inspectionPoint: string;
  accessLevel: AccessLevel;
}

export interface PermittedProposal {
  proposalType: string; // tighten_control_limit, new_defect_mode, spc_threshold_adjustment
  reviewTarget: string;
}

export interface AiHarnessDecl {
  kind: 'AI_HARNESS';
  name: string;
  description: string;
  permittedObservations: PermittedObservation[];
  permittedProposals: PermittedProposal[];
  forbiddenActions: string[]; // identifiers; standard set is implicit
  proposalReviewQueue: string;
  runtimeSandbox: SandboxMode;
  location: SourceSpan;
}

// --- AUDIT_TRAIL ---

export interface AuditTrailDecl {
  kind: 'AUDIT_TRAIL';
  name: string;
  captures: CaptureClass[];
  storage: StorageMode;
  retention: Duration;
  exportFormats: ExportFormat[];
  streamingTo?: string;
  timestampPrecision: TimestampPrecision;
  provenanceChain: ProvenanceChainMode;
  tamperEvident: TamperEvidentMode;
  location: SourceSpan;
}

// --- PRODUCTION_SYSTEM ---

export interface ProductionSystemDecl {
  kind: 'PRODUCTION_SYSTEM';
  name: string;
  systemKind: SystemKind;
  source: string;
  eventBridge: EventBridgeKind;
  mock: boolean;
  location: SourceSpan;
}

// --- Declaration union ---

export type QcDeclaration =
  | ControlPlanDecl
  | InspectionPointDecl
  | ControlLimitDecl
  | SpcChartDecl
  | DefectModeDecl
  | AcceptanceCriterionDecl
  | PokaYokeDecl
  | AndonDecl
  | AiHarnessDecl
  | AuditTrailDecl
  | ProductionSystemDecl;

// =============================================================================
// FILE
// =============================================================================

export interface QcFile {
  controlPlan: ControlPlanDecl; // required, exactly one
  inspectionPoints: InspectionPointDecl[]; // at least one required
  controlLimits: ControlLimitDecl[];
  spcCharts: SpcChartDecl[];
  defectModes: DefectModeDecl[];
  acceptanceCriteria: AcceptanceCriterionDecl[];
  pokaYokes: PokaYokeDecl[];
  andons: AndonDecl[];
  aiHarness: AiHarnessDecl; // exactly one required
  auditTrail: AuditTrailDecl; // exactly one required
  productionSystem: ProductionSystemDecl; // exactly one required
}

// =============================================================================
// PARSE ERROR
// =============================================================================

export interface ParseError {
  message: string;
  location: SourceLocation;
  hint?: string;
}
