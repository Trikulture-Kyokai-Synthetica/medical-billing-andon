// QC harness runtime — the interpreter that runs a validated QcFile against
// an event stream. The substrate the demo and (eventually) production
// deployments execute on.

import type {
  QcFile,
  ControlLimitDecl,
  DefectModeDecl,
  AcceptanceCriterionDecl,
  PokaYokeDecl,
  AndonDecl,
  SpcChartDecl,
  FieldPath,
} from '../../qc-parser/src/index.js';
import { PredicateRegistry, UnresolvedReferenceError } from './predicate-registry.js';
import { evaluatePredicate } from './predicate-evaluator.js';
import { SpcChartState } from './spc-chart-state.js';
import type {
  AuditEntry,
  AuditCallback,
  EmitResult,
  InspectionEvent,
  AndonFiringAuditEntry,
} from './types.js';
import type { PredicateExpr } from '../../qc-parser/src/index.js';

export interface RuntimeOptions {
  predicateRegistry?: PredicateRegistry;
  // For deterministic tests: replace Date.now()
  now?: () => number;
}

export class Runtime {
  private file: QcFile;
  private registry: PredicateRegistry;
  private auditSubscribers: AuditCallback[] = [];
  private now: () => number;
  // Per-instance monotonic counter for audit ids. Per-instance (not
  // module-global) so two Runtimes replaying the same stream produce the
  // same id sequence — a precondition for byte-identical audit replay.
  private auditCounter = 0;

  // Indexes for fast per-event dispatch
  private controlLimitsByPoint: Map<string, ControlLimitDecl[]>;
  private defectModesByPoint: Map<string, DefectModeDecl[]>;
  private acceptanceCriteriaByPoint: Map<string, AcceptanceCriterionDecl[]>;
  private pokaYokesByPoint: Map<string, PokaYokeDecl[]>;
  private spcChartsByPoint: Map<string, SpcChartDecl[]>;
  private andonsByName: Map<string, AndonDecl>;

  // SPC chart state per declared chart (keyed by chart name)
  private spcStates: Map<string, SpcChartState>;

  constructor(file: QcFile, options: RuntimeOptions = {}) {
    this.file = file;
    this.registry = options.predicateRegistry ?? new PredicateRegistry();
    this.now = options.now ?? (() => Date.now());

    this.controlLimitsByPoint = indexBy(file.controlLimits, (d) => d.point);
    this.defectModesByPoint = indexBy(file.defectModes, (d) => d.point);
    this.acceptanceCriteriaByPoint = indexBy(file.acceptanceCriteria, (d) => d.point);
    this.pokaYokesByPoint = indexBy(file.pokaYokes, (d) => d.blocks);
    this.spcChartsByPoint = indexBy(file.spcCharts, (d) => d.point);
    this.andonsByName = new Map(file.andons.map((a) => [a.name, a]));

    this.spcStates = new Map();
    for (const chart of file.spcCharts) {
      this.spcStates.set(chart.name, new SpcChartState(chart));
    }
  }

  /**
   * Seed an SPC chart's baseline directly, bypassing the accumulation phase.
   * Useful for testing and for demos that need to skip past baseline.
   */
  seedSpcBaseline(chartName: string, centerLine: number, stdDev: number): void {
    const state = this.spcStates.get(chartName);
    if (!state) {
      throw new Error(`Unknown SPC chart: ${chartName}`);
    }
    state.setBaselineDirectly(centerLine, stdDev);
  }

  getSpcChartState(chartName: string): SpcChartState | undefined {
    return this.spcStates.get(chartName);
  }

  // --- Public API ---

  onAuditEntry(cb: AuditCallback): () => void {
    this.auditSubscribers.push(cb);
    return () => {
      this.auditSubscribers = this.auditSubscribers.filter((s) => s !== cb);
    };
  }

  getRegistry(): PredicateRegistry {
    return this.registry;
  }

  /**
   * Emit an event into the runtime. Drives the QC harness program through
   * one cycle of evaluation. Returns whether the production action is allowed
   * to proceed, plus any Andons fired and any customer-facing recovery message.
   */
  emit(point: string, payload: Record<string, unknown>): EmitResult {
    const event: InspectionEvent = { point, payload, timestamp: this.now() };
    const result: EmitResult = { allowed: true, andonsFired: [] };

    this.recordInspection(event);

    // 1. Poka-yokes run first — they can block input before anything else sees it.
    for (const py of this.pokaYokesByPoint.get(point) ?? []) {
      // Fail closed: an unevaluable poka-yoke guard blocks the input.
      const matched = this.evalGuard(py.when, payload, {
        construct: `POKA_YOKE ${py.name}`,
        point,
        timestamp: event.timestamp,
        failClosedValue: true,
        resolution: 'blocked',
      });
      this.recordAudit({
        timestamp: event.timestamp,
        id: this.newAuditId(),
        kind: 'poka_yoke_evaluation',
        name: py.name,
        point,
        blocked: matched,
        reply: matched ? py.reply : undefined,
      });
      if (matched) {
        result.allowed = false;
        result.customerMessage = py.reply;
        // Poka-yoke blocks short-circuit further evaluation.
        return result;
      }
    }

    // 2. Acceptance criteria gate production actions.
    for (const ac of this.acceptanceCriteriaByPoint.get(point) ?? []) {
      // Fail closed: a criterion whose REQUIRES can't be evaluated does NOT pass.
      const passed = this.evalGuard(ac.requires, payload, {
        construct: `ACCEPTANCE_CRITERION ${ac.name}`,
        point,
        timestamp: event.timestamp,
        failClosedValue: false,
        resolution: 'not passed (gate blocked)',
      });
      this.recordAudit({
        timestamp: event.timestamp,
        id: this.newAuditId(),
        kind: 'acceptance_criterion_evaluation',
        name: ac.name,
        point,
        passed,
      });
      if (!passed) {
        if (ac.onFail.kind === 'andon_ref') {
          const recovery = this.fireAndon(ac.onFail.andonName, `ACCEPTANCE_CRITERION ${ac.name}`, event.timestamp);
          result.andonsFired.push(ac.onFail.andonName);
          result.allowed = false;
          if (recovery !== undefined) result.customerMessage = recovery;
        } else if (ac.onFail.kind === 'propose_review') {
          this.recordProposal(`acceptance_criterion_review`, {
            criterion: ac.name,
            point,
            reviewTarget: ac.onFail.target.name,
          }, event.timestamp);
        }
      }
    }

    // 3. Control limits.
    for (const cl of this.controlLimitsByPoint.get(point) ?? []) {
      // Fail closed: if the WHEN guard can't be evaluated, apply the limit
      // rather than skipping it.
      if (cl.when && !this.evalGuard(cl.when, payload, {
        construct: `CONTROL_LIMIT ${cl.name}`,
        point,
        timestamp: event.timestamp,
        failClosedValue: true,
        resolution: 'guard treated as matched; limit applied',
      })) continue;
      const measuredRaw = resolveFieldPath(cl.measure, payload);
      const measured = typeof measuredRaw === 'number' ? measuredRaw : Number(measuredRaw);
      // Fail closed on an unresolvable measure: a bound was declared but the
      // signal is missing/null/non-numeric, so we can't confirm it's within
      // limits — treat that as a violation rather than silently passing.
      const measurable = Number.isFinite(measured);
      const violated =
        (cl.upper !== undefined && (!measurable || measured > cl.upper)) ||
        (cl.lower !== undefined && (!measurable || measured < cl.lower));
      if (!measurable && (cl.upper !== undefined || cl.lower !== undefined)) {
        this.recordAudit({
          timestamp: event.timestamp,
          id: this.newAuditId(),
          kind: 'harness_error',
          construct: `CONTROL_LIMIT ${cl.name}`,
          point,
          reference: cl.measure.segments.join('.'),
          message: `measure '${cl.measure.segments.join('.')}' did not resolve to a finite number`,
          resolution: 'treated as violation',
        });
      }
      this.recordAudit({
        timestamp: event.timestamp,
        id: this.newAuditId(),
        kind: 'control_limit_evaluation',
        name: cl.name,
        point,
        measure: cl.measure.segments.join('.'),
        measuredValue: measured,
        upper: cl.upper,
        lower: cl.lower,
        violated,
      });
      if (violated && cl.onViolation.kind === 'andon_ref') {
        const recovery = this.fireAndon(cl.onViolation.andonName, `CONTROL_LIMIT ${cl.name}`, event.timestamp);
        result.andonsFired.push(cl.onViolation.andonName);
        result.allowed = false;
        if (recovery !== undefined && result.customerMessage === undefined) {
          result.customerMessage = recovery;
        }
      } else if (violated && cl.onViolation.kind === 'propose_review') {
        this.recordProposal(`control_limit_review`, {
          limit: cl.name,
          point,
          measuredValue: measured,
          reviewTarget: cl.onViolation.target.name,
        }, event.timestamp);
      }
    }

    // 4. Defect modes.
    for (const dm of this.defectModesByPoint.get(point) ?? []) {
      // Fail closed: a defect check that can't be evaluated flags the defect.
      const detected = this.evalGuard(dm.detects, payload, {
        construct: `DEFECT_MODE ${dm.name}`,
        point,
        timestamp: event.timestamp,
        failClosedValue: true,
        resolution: 'flagged as detected',
      });
      this.recordAudit({
        timestamp: event.timestamp,
        id: this.newAuditId(),
        kind: 'defect_mode_evaluation',
        name: dm.name,
        point,
        severity: dm.severity,
        detected,
      });
      if (detected && dm.onDetect.kind === 'andon_ref') {
        const recovery = this.fireAndon(dm.onDetect.andonName, `DEFECT_MODE ${dm.name}`, event.timestamp);
        result.andonsFired.push(dm.onDetect.andonName);
        result.allowed = false;
        if (recovery !== undefined && result.customerMessage === undefined) {
          result.customerMessage = recovery;
        }
      } else if (detected && dm.onDetect.kind === 'propose_review') {
        this.recordProposal(`defect_mode_review`, {
          defectMode: dm.name,
          point,
          severity: dm.severity,
          reviewTarget: dm.onDetect.target.name,
        }, event.timestamp);
      }
    }

    // 5. SPC charts — statistical drift detection.
    for (const chart of this.spcChartsByPoint.get(point) ?? []) {
      // Fail closed: an unevaluable WHEN guard still records the point.
      if (chart.when && !this.evalGuard(chart.when, payload, {
        construct: `SPC_CHART ${chart.name}`,
        point,
        timestamp: event.timestamp,
        failClosedValue: true,
        resolution: 'guard treated as matched; point observed',
      })) continue;
      const measuredRaw = resolveFieldPath(chart.measure, payload);
      const measured = typeof measuredRaw === 'number' ? measuredRaw : Number(measuredRaw);
      if (!Number.isFinite(measured)) continue;

      const state = this.spcStates.get(chart.name)!;
      const violation = state.observe(measured, event.timestamp);

      this.recordAudit({
        timestamp: event.timestamp,
        id: this.newAuditId(),
        kind: 'spc_chart_update',
        name: chart.name,
        point,
        measure: chart.measure.segments.join('.'),
        measuredValue: measured,
        inBaseline: state.inBaseline(),
        centerLine: state.getCenterLine(),
        stdDev: state.getStdDev(),
        ruleViolated: violation?.rule ?? null,
      });

      if (violation) {
        if (chart.onRuleViolation.kind === 'andon_ref') {
          const recovery = this.fireAndon(
            chart.onRuleViolation.andonName,
            `SPC_CHART ${chart.name} ${violation.rule}`,
            event.timestamp
          );
          result.andonsFired.push(chart.onRuleViolation.andonName);
          result.allowed = false;
          if (recovery !== undefined && result.customerMessage === undefined) {
            result.customerMessage = recovery;
          }
        } else if (chart.onRuleViolation.kind === 'propose_review') {
          // "Propose, don't halt" — emit an ai_proposal audit entry. Production
          // continues; a human reviewer is notified via the proposal queue.
          this.recordAudit({
            timestamp: event.timestamp,
            id: this.newAuditId(),
            kind: 'ai_proposal',
            proposalType: `spc_review_${violation.rule}`,
            details: {
              chart: chart.name,
              reviewTarget: chart.onRuleViolation.target.name,
              description: violation.description,
              measuredValue: measured,
              centerLine: state.getCenterLine(),
              stdDev: state.getStdDev(),
            },
          });
        }
      }
    }

    return result;
  }

  // --- Internal ---

  private newAuditId(): string {
    this.auditCounter += 1;
    // Sourced from the injectable clock (not raw Date.now()) so a seeded
    // replay reproduces the id sequence exactly.
    return `audit_${this.now()}_${this.auditCounter}`;
  }

  /**
   * Record a "propose, don't halt" review request as an `ai_proposal` audit
   * entry. Used by ACCEPTANCE_CRITERION / CONTROL_LIMIT / DEFECT_MODE whose
   * ON_FAIL / ON_VIOLATION / ON_DETECT is PROPOSE_REVIEW rather than an Andon
   * — previously these branches were silently dropped, so the review request
   * evaporated with no audit trail.
   */
  private recordProposal(
    proposalType: string,
    details: Record<string, unknown>,
    timestamp: number,
  ): void {
    this.recordAudit({
      timestamp,
      id: this.newAuditId(),
      kind: 'ai_proposal',
      proposalType,
      details,
    });
  }

  /**
   * Evaluate a guard/condition predicate, resolving a misconfigured
   * (unregistered) reference FAIL-CLOSED. `failClosedValue` is the boolean
   * to return when the predicate can't be evaluated — chosen per construct
   * so the safe outcome is block/flag, never silent pass. Records a
   * `harness_error` audit entry so the misconfiguration is visible.
   */
  private evalGuard(
    expr: PredicateExpr,
    payload: Record<string, unknown>,
    ctx: { construct: string; point: string; timestamp: number; failClosedValue: boolean; resolution: string },
  ): boolean {
    try {
      return evaluatePredicate(expr, payload, this.registry);
    } catch (err) {
      if (err instanceof UnresolvedReferenceError) {
        this.recordAudit({
          timestamp: ctx.timestamp,
          id: this.newAuditId(),
          kind: 'harness_error',
          construct: ctx.construct,
          point: ctx.point,
          reference: err.reference,
          message: err.message,
          resolution: ctx.resolution,
        });
        return ctx.failClosedValue;
      }
      throw err;
    }
  }

  private recordInspection(event: InspectionEvent): void {
    this.recordAudit({
      timestamp: event.timestamp,
      id: this.newAuditId(),
      kind: 'inspection',
      point: event.point,
      payload: event.payload,
    });
  }

  private fireAndon(name: string, triggeredBy: string, timestamp: number): string | undefined {
    const andon = this.andonsByName.get(name);
    if (!andon) {
      // Should be caught by the validator; defensive guard.
      return undefined;
    }
    const firing: AndonFiringAuditEntry = {
      timestamp,
      id: this.newAuditId(),
      kind: 'andon_firing',
      name: andon.name,
      halt: andon.halt,
      preserve: andon.preserve,
      escalate: andon.escalate,
      triggeredBy,
      audit: andon.audit,
      demoVisible: andon.demoVisible,
      colorTag: andon.colorTag,
    };
    this.recordAudit(firing);

    // Execute the recovery action
    let customerMessage: string | undefined = undefined;
    if (andon.recovery.kind === 'graceful_fallback') {
      customerMessage = andon.recovery.message;
    } else if (andon.recovery.kind === 'route_to_default_human_queue') {
      customerMessage = 'I will route this to a human team member now.';
    } else if (andon.recovery.kind === 'retry_with_valid_tool') {
      // For the first-cut runtime, the IF condition is not evaluated at fire
      // time (it lives in a static spec); we fall through to the else branch's
      // simple recovery. Production may pick up the IF semantic.
      if (andon.recovery.elseAction.kind === 'graceful_fallback') {
        customerMessage = andon.recovery.elseAction.message;
      }
    } else if (andon.recovery.kind === 'manual') {
      // No automatic customer message; operator picks up the case.
      customerMessage = undefined;
    } else if (andon.recovery.kind === 'custom') {
      // Custom recovery names are domain-specific; first-cut returns undefined.
      customerMessage = undefined;
    }

    this.recordAudit({
      timestamp,
      id: this.newAuditId(),
      kind: 'recovery_execution',
      andonName: andon.name,
      recovery: andon.recovery,
      customerMessage,
    });

    return customerMessage;
  }

  private recordAudit(entry: AuditEntry): void {
    for (const sub of this.auditSubscribers) {
      try {
        sub(entry);
      } catch {
        // Subscriber errors do not break the runtime.
      }
    }
  }
}

// --- Helpers ---

function indexBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

function resolveFieldPath(fp: FieldPath, payload: Record<string, unknown>): unknown {
  let current: unknown = payload;
  for (const segment of fp.segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
