// Agicore QC Dialect Validator
//
// Second-pass validation of a parsed QcFile. Catches cross-reference errors
// the parser cannot catch in a single forward pass: dangling Andon references,
// undeclared inspection points, field paths that don't resolve, mismatched
// CONTROL_PLAN enumerations, duplicate declaration names, and so on.
//
// Usage:
//   const file = parse(source);
//   const result = validate(file);
//   if (!result.valid) {
//     for (const err of result.errors) console.error(err.message);
//   }
//
// The validator is intentionally separate from the parser. Parsing produces
// a syntactically valid AST; validation produces a semantically consistent one.
// Codegen consumes a validated AST.

import type {
  QcFile,
  ControlLimitDecl,
  SpcChartDecl,
  DefectModeDecl,
  AcceptanceCriterionDecl,
  PokaYokeDecl,
  AndonDecl,
  InspectionPointDecl,
  ControlPlanEnumeration,
  PredicateExpr,
  TriggerAction,
  FieldPath,
  SourceLocation,
  QcPrimitiveType,
} from './types.js';

// --- Result types ---

export type ValidationErrorKind =
  | 'unresolved_andon'
  | 'unresolved_inspection_point'
  | 'unresolved_field_path'
  | 'unresolved_control_plan_audit_trail'
  | 'unresolved_control_plan_ai_harness'
  | 'unresolved_control_plan_production_system'
  | 'unresolved_permitted_observation'
  | 'enumeration_mismatch'
  | 'duplicate_declaration'
  | 'standard_forbidden_action_missing'
  | 'inconsistent_severity'
  | 'authority_format';

export interface ValidationError {
  kind: ValidationErrorKind;
  message: string;
  location: SourceLocation;
  hint?: string;
}

export interface ValidationWarning {
  message: string;
  location: SourceLocation;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// --- Standard forbidden actions (must always be present in AI_HARNESS) ---

const STANDARD_FORBIDDEN_ACTIONS = [
  'modify_control_plan',
  'loosen_control_limit',
  'override_andon',
  'suppress_audit_entry',
  'bypass_acceptance_criterion',
  'bypass_poka_yoke',
  'grant_self_new_permissions',
  'take_direct_production_action_outside_acceptance_gates',
];

// =============================================================================
// VALIDATE
// =============================================================================

export function validate(file: QcFile): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const ctx = buildContext(file);

  checkDuplicateDeclarations(file, errors);
  checkControlPlanReferences(file, ctx, errors);
  checkControlPlanEnumerations(file, ctx, errors);
  checkAndonReferences(file, ctx, errors);
  checkInspectionPointReferences(file, ctx, errors);
  checkFieldPathResolution(file, ctx, errors);
  checkPermittedObservations(file, ctx, errors);
  checkStandardForbiddenActions(file, errors);
  checkSeverityConsistency(file, warnings);
  checkSpcChartTypeSupport(file, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// CONTEXT
// =============================================================================

interface ValidationContext {
  andonNames: Set<string>;
  inspectionPointSchemas: Map<string, Map<string, QcPrimitiveType>>;
  controlLimitNames: Set<string>;
  spcChartNames: Set<string>;
  defectModeNames: Set<string>;
  acceptanceCriterionNames: Set<string>;
  pokaYokeNames: Set<string>;
  inspectionPointNames: Set<string>;
}

function buildContext(file: QcFile): ValidationContext {
  const andonNames = new Set<string>();
  for (const a of file.andons) andonNames.add(a.name);

  const inspectionPointSchemas = new Map<string, Map<string, QcPrimitiveType>>();
  const inspectionPointNames = new Set<string>();
  for (const ip of file.inspectionPoints) {
    inspectionPointNames.add(ip.name);
    const fields = new Map<string, QcPrimitiveType>();
    for (const f of ip.captures) fields.set(f.name, f.type);
    inspectionPointSchemas.set(ip.name, fields);
  }

  const controlLimitNames = new Set<string>(file.controlLimits.map((c) => c.name));
  const spcChartNames = new Set<string>(file.spcCharts.map((c) => c.name));
  const defectModeNames = new Set<string>(file.defectModes.map((d) => d.name));
  const acceptanceCriterionNames = new Set<string>(file.acceptanceCriteria.map((a) => a.name));
  const pokaYokeNames = new Set<string>(file.pokaYokes.map((p) => p.name));

  return {
    andonNames,
    inspectionPointSchemas,
    controlLimitNames,
    spcChartNames,
    defectModeNames,
    acceptanceCriterionNames,
    pokaYokeNames,
    inspectionPointNames,
  };
}

// =============================================================================
// CHECKS
// =============================================================================

function checkDuplicateDeclarations(file: QcFile, errors: ValidationError[]) {
  const checkSet = (
    decls: { name: string; location: { start: SourceLocation } }[],
    kind: string
  ) => {
    const seen = new Set<string>();
    for (const d of decls) {
      if (seen.has(d.name)) {
        errors.push({
          kind: 'duplicate_declaration',
          message: `Duplicate ${kind} declaration: '${d.name}'`,
          location: d.location.start,
        });
      } else {
        seen.add(d.name);
      }
    }
  };

  checkSet(file.inspectionPoints, 'INSPECTION_POINT');
  checkSet(file.controlLimits, 'CONTROL_LIMIT');
  checkSet(file.spcCharts, 'SPC_CHART');
  checkSet(file.defectModes, 'DEFECT_MODE');
  checkSet(file.acceptanceCriteria, 'ACCEPTANCE_CRITERION');
  checkSet(file.pokaYokes, 'POKA_YOKE');
  checkSet(file.andons, 'ANDON');
}

function checkControlPlanReferences(
  file: QcFile,
  _ctx: ValidationContext,
  errors: ValidationError[]
) {
  const plan = file.controlPlan;
  if (plan.auditTrail !== file.auditTrail.name) {
    errors.push({
      kind: 'unresolved_control_plan_audit_trail',
      message: `CONTROL_PLAN references AUDIT_TRAIL '${plan.auditTrail}' but the declared AUDIT_TRAIL is named '${file.auditTrail.name}'`,
      location: plan.location.start,
    });
  }
  if (plan.aiHarness !== file.aiHarness.name) {
    errors.push({
      kind: 'unresolved_control_plan_ai_harness',
      message: `CONTROL_PLAN references AI_HARNESS '${plan.aiHarness}' but the declared AI_HARNESS is named '${file.aiHarness.name}'`,
      location: plan.location.start,
    });
  }
  if (plan.productionSystem !== file.productionSystem.name) {
    errors.push({
      kind: 'unresolved_control_plan_production_system',
      message: `CONTROL_PLAN references PRODUCTION_SYSTEM '${plan.productionSystem}' but the declared PRODUCTION_SYSTEM is named '${file.productionSystem.name}'`,
      location: plan.location.start,
    });
  }
  // Authority should look like a dotted identifier with at least one dot.
  // (The parser already requires at least one identifier; this just nudges
  // toward the convention.)
  if (!plan.authority.includes('.')) {
    errors.push({
      kind: 'authority_format',
      message: `CONTROL_PLAN AUTHORITY should be a dotted identifier (e.g., 'parish.compliance_team'); got '${plan.authority}'`,
      location: plan.location.start,
    });
  }
}

function checkControlPlanEnumerations(
  file: QcFile,
  ctx: ValidationContext,
  errors: ValidationError[]
) {
  if (file.controlPlan.enumerations.length === 0) return;

  const enumerationKindToActualNames: Record<ControlPlanEnumeration['kind'], Set<string>> = {
    INSPECTION_POINTS: ctx.inspectionPointNames,
    CONTROL_LIMITS: ctx.controlLimitNames,
    SPC_CHARTS: ctx.spcChartNames,
    DEFECT_MODES: ctx.defectModeNames,
    ACCEPTANCE_CRITERIA: ctx.acceptanceCriterionNames,
    POKA_YOKES: ctx.pokaYokeNames,
    ANDONS: ctx.andonNames,
  };

  for (const enumeration of file.controlPlan.enumerations) {
    const actual = enumerationKindToActualNames[enumeration.kind];
    const claimed = new Set(enumeration.members);

    // Items in enumeration but not actually declared
    for (const member of enumeration.members) {
      if (!actual.has(member)) {
        errors.push({
          kind: 'enumeration_mismatch',
          message: `CONTROL_PLAN ${enumeration.kind} lists '${member}' but no such declaration exists`,
          location: file.controlPlan.location.start,
        });
      }
    }

    // Items declared but not in enumeration
    for (const name of actual) {
      if (!claimed.has(name)) {
        errors.push({
          kind: 'enumeration_mismatch',
          message: `${enumeration.kind} enumeration is present but does not include declared '${name}'`,
          location: file.controlPlan.location.start,
          hint: 'If you list ANY items in this enumeration, you must list ALL of that declaration type',
        });
      }
    }
  }
}

function checkAndonReferences(file: QcFile, ctx: ValidationContext, errors: ValidationError[]) {
  const checkTriggerAction = (action: TriggerAction, where: string, location: SourceLocation) => {
    if (action.kind === 'andon_ref') {
      if (!ctx.andonNames.has(action.andonName)) {
        errors.push({
          kind: 'unresolved_andon',
          message: `${where} references undeclared ANDON '${action.andonName}'`,
          location,
        });
      }
    }
  };

  for (const cl of file.controlLimits) {
    checkTriggerAction(cl.onViolation, `CONTROL_LIMIT '${cl.name}' ON_VIOLATION`, cl.location.start);
  }
  for (const ch of file.spcCharts) {
    checkTriggerAction(ch.onRuleViolation, `SPC_CHART '${ch.name}' ON_RULE_VIOLATION`, ch.location.start);
  }
  for (const dm of file.defectModes) {
    checkTriggerAction(dm.onDetect, `DEFECT_MODE '${dm.name}' ON_DETECT`, dm.location.start);
  }
  for (const ac of file.acceptanceCriteria) {
    checkTriggerAction(ac.onFail, `ACCEPTANCE_CRITERION '${ac.name}' ON_FAIL`, ac.location.start);
  }
}

function checkInspectionPointReferences(
  file: QcFile,
  ctx: ValidationContext,
  errors: ValidationError[]
) {
  const checkPointRef = (name: string, where: string, location: SourceLocation) => {
    if (!ctx.inspectionPointNames.has(name)) {
      errors.push({
        kind: 'unresolved_inspection_point',
        message: `${where} references undeclared INSPECTION_POINT '${name}'`,
        location,
      });
    }
  };

  for (const cl of file.controlLimits) {
    checkPointRef(cl.point, `CONTROL_LIMIT '${cl.name}' POINT`, cl.location.start);
  }
  for (const ch of file.spcCharts) {
    checkPointRef(ch.point, `SPC_CHART '${ch.name}' POINT`, ch.location.start);
  }
  for (const dm of file.defectModes) {
    checkPointRef(dm.point, `DEFECT_MODE '${dm.name}' POINT`, dm.location.start);
  }
  for (const ac of file.acceptanceCriteria) {
    checkPointRef(ac.point, `ACCEPTANCE_CRITERION '${ac.name}' POINT`, ac.location.start);
  }
  for (const py of file.pokaYokes) {
    checkPointRef(py.blocks, `POKA_YOKE '${py.name}' BLOCKS`, py.location.start);
  }
}

function checkFieldPathResolution(
  file: QcFile,
  ctx: ValidationContext,
  errors: ValidationError[]
) {
  const resolveAgainst = (
    fp: FieldPath,
    pointName: string,
    where: string,
    location: SourceLocation
  ) => {
    const schema = ctx.inspectionPointSchemas.get(pointName);
    if (!schema) return; // already reported as unresolved inspection point
    const first = fp.segments[0];
    if (!first) return;
    if (!schema.has(first)) {
      errors.push({
        kind: 'unresolved_field_path',
        message: `${where} references field '${fp.segments.join('.')}' but '${first}' is not declared in INSPECTION_POINT '${pointName}' CAPTURES`,
        location,
        hint: `declared CAPTURES fields: ${Array.from(schema.keys()).join(', ')}`,
      });
      return;
    }
    // Multi-segment field paths are only valid against json-typed fields
    if (fp.segments.length > 1) {
      const headType = schema.get(first);
      if (headType !== 'json') {
        errors.push({
          kind: 'unresolved_field_path',
          message: `${where} references nested field '${fp.segments.join('.')}' but '${first}' has type '${headType}' (only 'json' supports nested access)`,
          location,
        });
      }
    }
  };

  // 'boolean' position: bare identifiers are named-predicate references
  //   (runtime-resolved; no validator error).
  // 'value' position: bare identifiers are single-segment field paths and
  //   must resolve against the inspection point's CAPTURES schema.
  type Position = 'boolean' | 'value';

  const walkPredicate = (
    expr: PredicateExpr,
    pointName: string,
    where: string,
    location: SourceLocation,
    position: Position
  ) => {
    switch (expr.kind) {
      case 'comparison':
        walkPredicate(expr.left, pointName, where, location, 'value');
        walkPredicate(expr.right, pointName, where, location, 'value');
        break;
      case 'membership':
        walkPredicate(expr.value, pointName, where, location, 'value');
        break;
      case 'null_check':
        walkPredicate(expr.expr, pointName, where, location, 'value');
        break;
      case 'contains':
        walkPredicate(expr.subject, pointName, where, location, 'value');
        break;
      case 'matches':
        walkPredicate(expr.subject, pointName, where, location, 'value');
        break;
      case 'boolean':
        for (const op of expr.operands) walkPredicate(op, pointName, where, location, 'boolean');
        break;
      case 'parenthesized':
        walkPredicate(expr.inner, pointName, where, location, position);
        break;
      case 'field_path':
        resolveAgainst(expr, pointName, where, location);
        break;
      case 'identifier':
        if (position === 'value') {
          const fp: FieldPath = { kind: 'field_path', segments: [expr.name] };
          resolveAgainst(fp, pointName, where, location);
        }
        // boolean position: named predicate reference, runtime-resolved
        break;
      case 'literal':
        break;
    }
  };

  for (const cl of file.controlLimits) {
    resolveAgainst(cl.measure, cl.point, `CONTROL_LIMIT '${cl.name}' MEASURE`, cl.location.start);
    if (cl.when)
      walkPredicate(cl.when, cl.point, `CONTROL_LIMIT '${cl.name}' WHEN`, cl.location.start, 'boolean');
  }
  for (const ch of file.spcCharts) {
    resolveAgainst(ch.measure, ch.point, `SPC_CHART '${ch.name}' MEASURE`, ch.location.start);
    if (ch.when)
      walkPredicate(ch.when, ch.point, `SPC_CHART '${ch.name}' WHEN`, ch.location.start, 'boolean');
  }
  for (const dm of file.defectModes) {
    walkPredicate(dm.detects, dm.point, `DEFECT_MODE '${dm.name}' DETECTS`, dm.location.start, 'boolean');
  }
  for (const ac of file.acceptanceCriteria) {
    walkPredicate(
      ac.requires,
      ac.point,
      `ACCEPTANCE_CRITERION '${ac.name}' REQUIRES`,
      ac.location.start,
      'boolean'
    );
  }
  for (const py of file.pokaYokes) {
    walkPredicate(py.when, py.blocks, `POKA_YOKE '${py.name}' WHEN`, py.location.start, 'boolean');
  }
}

function checkPermittedObservations(
  file: QcFile,
  ctx: ValidationContext,
  errors: ValidationError[]
) {
  for (const obs of file.aiHarness.permittedObservations) {
    if (!ctx.inspectionPointNames.has(obs.inspectionPoint)) {
      errors.push({
        kind: 'unresolved_permitted_observation',
        message: `AI_HARNESS PERMITTED_OBSERVATIONS references undeclared INSPECTION_POINT '${obs.inspectionPoint}'`,
        location: file.aiHarness.location.start,
      });
    }
  }
}

function checkStandardForbiddenActions(file: QcFile, errors: ValidationError[]) {
  // The parser merges the standard forbidden actions at parse time, so this
  // check should always pass — but we double-check in case the AST was
  // constructed manually or modified after parsing.
  const present = new Set(file.aiHarness.forbiddenActions);
  for (const std of STANDARD_FORBIDDEN_ACTIONS) {
    if (!present.has(std)) {
      errors.push({
        kind: 'standard_forbidden_action_missing',
        message: `AI_HARNESS is missing standard forbidden action '${std}' (this is enforced regardless)`,
        location: file.aiHarness.location.start,
      });
    }
  }
}

// The runtime (qc-runtime SpcChartState) implements a single control model —
// an individuals chart: one measurement per event, center line and σ from the
// baseline of individual points, Western Electric run rules on single points.
// The grammar accepts eight CHART_TYPE values, but subgroup charts (xbar/r/s)
// and attribute charts (p/c/u) need different statistics (subgroup means,
// ranges, proportions). Declaring one of those doesn't error — but it is
// silently computed as an individuals chart, so its "3σ" limits are not the
// limits that chart type implies. Warn so the mismatch is visible rather than
// masquerading as a correctly-typed chart.
const RUNTIME_SUPPORTED_CHART_TYPES = new Set(['i', 'mr']);

function checkSpcChartTypeSupport(file: QcFile, warnings: ValidationWarning[]) {
  for (const ch of file.spcCharts) {
    if (!RUNTIME_SUPPORTED_CHART_TYPES.has(ch.chartType)) {
      warnings.push({
        message: `SPC_CHART '${ch.name}' declares CHART_TYPE '${ch.chartType}', but the runtime only implements individuals-chart math (i/mr). It will be computed as an individuals chart — one measurement per event — so the control limits are NOT the subgroup/attribute limits '${ch.chartType}' implies. Use CHART_TYPE i, or treat the limits as approximate until subgroup charts are implemented.`,
        location: ch.location.start,
      });
    }
  }
}

function checkSeverityConsistency(file: QcFile, warnings: ValidationWarning[]) {
  // If multiple defect modes target the same Andon, their severities should
  // ideally agree (so the Andon's response logic is consistent). This is a
  // warning, not an error.
  const andonToSeverities = new Map<string, Set<string>>();
  for (const dm of file.defectModes) {
    if (dm.onDetect.kind !== 'andon_ref') continue;
    const set = andonToSeverities.get(dm.onDetect.andonName) ?? new Set<string>();
    set.add(dm.severity);
    andonToSeverities.set(dm.onDetect.andonName, set);
  }
  for (const [andonName, severities] of andonToSeverities) {
    if (severities.size > 1) {
      const andon = file.andons.find((a) => a.name === andonName);
      warnings.push({
        message: `ANDON '${andonName}' is triggered by DEFECT_MODEs with inconsistent severities: ${Array.from(severities).join(', ')}`,
        location: andon?.location.start ?? { line: 1, column: 1 },
      });
    }
  }
}
