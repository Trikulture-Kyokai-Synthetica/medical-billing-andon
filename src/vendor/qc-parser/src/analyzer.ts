// Agicore QC dialect — semantic analysis (the "solver" pass).
//
// `validate()` is the compiler's front end: names resolve, declarations don't
// duplicate, enumerations match. It answers "is this a well-formed program?"
//
// `analyze()` is the semantic pass. It answers a different question, and the
// one that actually costs money in production:
//
//     Can any event ever pass this inspection point?
//
// A harness accumulates ACCEPTANCE_CRITERIA over time — especially one that
// learns from defects. Nothing stops two criteria from being jointly
// unsatisfiable, and nothing stops a set of individually-sensible criteria
// from rejecting every possible event. Neither shows up in validation, and
// neither shows up in a regression replay unless the corpus happens to contain
// the case. You find out in production, when everything starts halting.
//
// This is the same class of bug as two CHECK constraints on one table that no
// row can satisfy. The DDL is valid. The table can never hold data. A type
// checker tells you at authoring time; a test suite tells you later.
//
// ── Soundness ───────────────────────────────────────────────────────────────
//
// The predicate language is deliberately not Turing-complete — no loops, no
// recursion — which makes most of it decidable. The exception is predicates
// backed by registered code: named predicates, CONTAINS, MATCHES. Those are
// black boxes to static analysis.
//
// We treat them as UNINTERPRETED atoms: free boolean variables that may take
// either value. If a rule set is unsatisfiable even when every opaque atom is
// allowed to be anything, then it is *genuinely* unsatisfiable. So:
//
//   - Every conflict reported here is real.       (sound — no false alarms)
//   - Some real conflicts will not be reported.   (incomplete — by design)
//
// That is the honest trade, and it is the right direction for the error to
// point: an authoring-time checker that cries wolf gets switched off.

import type {
  QcFile,
  PredicateExpr,
  AcceptanceCriterionDecl,
  InspectionPointDecl,
  CaptureField,
} from './types.js';

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type AtomKind = 'boolean' | 'comparison' | 'membership' | 'null_check' | 'opaque';

export interface AtomInfo {
  /** Stable key identifying this atom across the whole formula. */
  key: string;
  kind: AtomKind;
  /** Human-readable rendering, for the UI and error messages. */
  label: string;
  /** Field this atom constrains, when it constrains exactly one. */
  field?: string;
  /** True when the atom is backed by registered code and cannot be reasoned about. */
  opaque: boolean;
}

export interface Witness {
  /** A concrete payload that passes every criterion at this point. */
  payload: Record<string, unknown>;
  /**
   * Opaque atoms the witness had to assume. The payload is only a real witness
   * if the registered code behind these agrees — which analysis cannot know.
   */
  assumptions: Array<{ label: string; value: boolean }>;
}

/**
 * A class of event that can never pass, described by pinning one field.
 *
 * This is the finding that a regression corpus structurally cannot produce.
 * A rule set can be perfectly satisfiable overall — some events get through —
 * while an entire category is silently impossible. Replay only notices if the
 * corpus happens to contain that category, which is exactly the case it won't
 * when the category is new, rare, or seasonal.
 */
export interface DeadClass {
  /** Captured field whose value defines the class. */
  field: string;
  /** The pinned value that makes admission impossible. */
  value: unknown;
  /** Human-readable: "units >= 2", "modifier_present = false". */
  label: string;
  /** Minimal set of constructs that make this class impossible. */
  conflict: string[];
  /**
   * True when more than one construct is needed to exclude the class.
   *
   * This is the signal worth alerting on. A class excluded by a SINGLE rule is
   * that rule doing its job — `modifier_required` excludes claims without a
   * modifier, which is the entire point of writing it. A class excluded only
   * by the INTERACTION of several rules is something nobody decided: each
   * author saw their own rule, none saw the combination.
   */
  emergent: boolean;
}

export interface PointAnalysis {
  point: string;
  /** Criteria (by name) gating this inspection point. */
  criteria: string[];
  /** POKA_YOKE blocks that also gate it — admission requires NOT(when). */
  pokaYokes: string[];
  /** False = no event can ever pass. The table that can never hold a row. */
  satisfiable: boolean;
  /** Present when satisfiable: a payload that gets through. */
  witness?: Witness;
  /**
   * Present when unsatisfiable: a MINIMAL set of constructs that conflict.
   * Minimal means removing any one of them makes the point satisfiable again,
   * so this is the actual repair site rather than the whole rule list.
   */
  conflict?: string[];
  /**
   * Criteria implied by the others. Not an error — often deliberate, as
   * defence in depth — but a learning harness that keeps appending will
   * accumulate these, and each one is a rule someone has to maintain.
   */
  redundant: string[];
  /**
   * Event classes that can never be admitted, even though the point as a
   * whole is satisfiable. Empty when nothing is silently excluded.
   */
  deadClasses: DeadClass[];
  atoms: AtomInfo[];
}

export interface AnalysisResult {
  points: PointAnalysis[];
  /** True when every inspection point can admit at least one event. */
  ok: boolean;
  /** Atoms analysis had to treat as free variables, deduplicated. */
  opaqueAtoms: AtomInfo[];
  /** Search was truncated (see `AnalyzeOptions.maxAtoms`); results still sound. */
  truncated: boolean;
}

export interface AnalyzeOptions {
  /**
   * Give up past this many distinct atoms at one point. Search is exponential
   * in the worst case; past this we report `truncated` rather than hang. A
   * truncated analysis never reports a false conflict — it just stops looking.
   */
  maxAtoms?: number;
  /** Skip the redundancy pass (one extra solve per criterion). */
  skipRedundancy?: boolean;
  /** Skip the dead-class scan (two extra solves per captured field). */
  skipDeadClasses?: boolean;
}

// =============================================================================
// ENTRY POINT
// =============================================================================

export function analyze(file: QcFile, opts: AnalyzeOptions = {}): AnalysisResult {
  const maxAtoms = opts.maxAtoms ?? 22;
  const points: PointAnalysis[] = [];
  const opaqueSeen = new Map<string, AtomInfo>();
  let truncated = false;

  for (const point of file.inspectionPoints) {
    const criteria = file.acceptanceCriteria.filter((c) => c.point === point.name);
    const pokaYokes = file.pokaYokes.filter((p) => p.blocks === point.name);

    // The admission formula for a point: every criterion must hold, and no
    // poka-yoke may trigger. A poka-yoke's WHEN is a *blocking* condition, so
    // admission requires its negation.
    const clauses: Array<{ name: string; expr: PredicateExpr }> = [
      ...criteria.map((c) => ({ name: c.name, expr: c.requires })),
      ...pokaYokes.map((p) => ({
        name: p.name,
        expr: { kind: 'boolean', op: 'NOT', operands: [p.when] } as PredicateExpr,
      })),
    ];

    const ctx = new AtomTable(point);
    for (const c of clauses) ctx.collect(c.expr);
    const atoms = ctx.list();
    for (const a of atoms) if (a.opaque && !opaqueSeen.has(a.key)) opaqueSeen.set(a.key, a);

    const analysis: PointAnalysis = {
      point: point.name,
      criteria: criteria.map((c) => c.name),
      pokaYokes: pokaYokes.map((p) => p.name),
      satisfiable: true,
      redundant: [],
      deadClasses: [],
      atoms,
    };

    if (clauses.length === 0) {
      // No gates at all: everything passes. Trivially satisfiable.
      analysis.witness = { payload: defaultPayload(point), assumptions: [] };
      points.push(analysis);
      continue;
    }

    if (atoms.length > maxAtoms) {
      truncated = true;
      points.push(analysis); // reported satisfiable-by-default; we simply didn't look
      continue;
    }

    const solved = solve(clauses.map((c) => c.expr), ctx);
    if (solved) {
      analysis.witness = buildWitness(solved, ctx, point);
      if (!opts.skipRedundancy) {
        analysis.redundant = findRedundant(clauses, ctx);
      }
      if (!opts.skipDeadClasses) {
        analysis.deadClasses = findDeadClasses(clauses, ctx, point);
      }
    } else {
      analysis.satisfiable = false;
      analysis.conflict = minimalConflict(clauses, ctx);
    }
    points.push(analysis);
  }

  return {
    points,
    ok: points.every((p) => p.satisfiable),
    opaqueAtoms: [...opaqueSeen.values()],
    truncated,
  };
}

// =============================================================================
// ATOM TABLE — flattening predicates into decidable pieces
// =============================================================================

interface NumericConstraint {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=';
  value: number;
}

class AtomTable {
  private atoms = new Map<string, AtomInfo>();
  private numeric = new Map<string, NumericConstraint>();
  /** field -> set of atom keys that are null-checks on it, by polarity. */
  private nullChecks = new Map<string, { isNull: string[]; notNull: string[] }>();
  readonly captures: Map<string, CaptureField>;

  constructor(point: InspectionPointDecl) {
    this.captures = new Map(point.captures.map((c) => [c.name, c]));
  }

  list(): AtomInfo[] {
    return [...this.atoms.values()];
  }
  numericFor(key: string): NumericConstraint | undefined {
    return this.numeric.get(key);
  }
  nullPolarity(): Array<{ field: string; isNull: string[]; notNull: string[] }> {
    return [...this.nullChecks.entries()].map(([field, v]) => ({ field, ...v }));
  }

  private add(info: AtomInfo): string {
    if (!this.atoms.has(info.key)) this.atoms.set(info.key, info);
    return info.key;
  }

  /**
   * Pin a captured boolean field to a value, returning the induced atom
   * assignment. Returns null when no atom in this formula reads the field —
   * pinning it then constrains nothing and the class isn't worth testing.
   */
  pinBoolean(field: string, value: boolean): Assignment | null {
    const assignment: Assignment = new Map();
    for (const atom of this.atoms.values()) {
      if (atom.kind === 'boolean' && atom.field === field) assignment.set(atom.key, value);
      if (atom.kind === 'null_check' && atom.field === field) assignment.set(atom.key, false);
    }
    return assignment.size > 0 ? assignment : null;
  }

  /**
   * Split a numeric field's domain at every threshold the program mentions and
   * return one representative class per region. `units < 2` yields the two
   * classes a reader would name themselves: below the threshold, and at or
   * above it.
   */
  numericClasses(field: string): Array<{ label: string; value: number; pin: Assignment }> {
    const constraints = [...this.numeric.entries()].filter(([, c]) => c.field === field);
    if (constraints.length === 0) return [];
    const thresholds = [...new Set(constraints.map(([, c]) => c.value))].sort((a, b) => a - b);
    const samples: Array<{ label: string; value: number }> = [];
    for (const t of thresholds) {
      samples.push({ label: `${field} < ${t}`, value: t - 1 });
      samples.push({ label: `${field} >= ${t}`, value: t });
    }
    return samples.map(({ label, value }) => {
      const pin: Assignment = new Map();
      for (const [key, c] of constraints) pin.set(key, satisfiesConstraint(value, c));
      return { label, value, pin };
    });
  }

  /** Walk a predicate, registering every leaf as an atom. */
  collect(expr: PredicateExpr): void {
    this.keyFor(expr);
  }

  /**
   * Map a predicate node to an atom key, or null when it's a boolean
   * combinator (which the solver walks structurally rather than as an atom).
   */
  keyFor(expr: PredicateExpr): string | null {
    switch (expr.kind) {
      case 'boolean':
        for (const op of expr.operands) this.keyFor(op);
        return null;
      case 'parenthesized':
        return this.keyFor(expr.inner);
      case 'literal':
        return null; // constant — folded by the evaluator
      case 'identifier': {
        // A bare identifier in boolean position is either a captured boolean
        // field or a named predicate. If CAPTURES declares it, we can reason
        // about it; otherwise it's registered code and therefore opaque.
        const cap = this.captures.get(expr.name);
        const opaque = !cap;
        return this.add({
          key: `id:${expr.name}`,
          kind: opaque ? 'opaque' : 'boolean',
          label: expr.name,
          field: cap ? expr.name : undefined,
          opaque,
        });
      }
      case 'field_path': {
        const path = expr.segments.join('.');
        const cap = this.captures.get(path);
        return this.add({
          key: `fp:${path}`,
          kind: cap ? 'boolean' : 'opaque',
          label: path,
          field: cap ? path : undefined,
          opaque: !cap,
        });
      }
      case 'comparison': {
        const field = fieldNameOf(expr.left);
        const literal = literalOf(expr.right);
        // Only field-vs-numeric-literal comparisons get interval reasoning.
        // Anything else (field vs field, string compares) stays opaque.
        if (field && typeof literal === 'number' && this.captures.has(field)) {
          const key = `cmp:${field}${expr.op}${literal}`;
          this.numeric.set(key, { field, op: expr.op, value: literal });
          return this.add({
            key,
            kind: 'comparison',
            label: `${field} ${expr.op} ${literal}`,
            field,
            opaque: false,
          });
        }
        return this.add({
          key: `cmpx:${render(expr.left)}${expr.op}${render(expr.right)}`,
          kind: 'opaque',
          label: `${render(expr.left)} ${expr.op} ${render(expr.right)}`,
          opaque: true,
        });
      }
      case 'membership': {
        const field = fieldNameOf(expr.value) ?? render(expr.value);
        // Set contents live in the runtime registry, not the program text, so
        // membership is opaque — but polarity still matters, so IN and NOT IN
        // over the same (field, set) share one atom with a negation on top.
        const key = `in:${field}:${expr.set.name}`;
        this.add({
          key,
          kind: 'membership',
          label: `${field} IN ${expr.set.name}`,
          field: this.captures.has(field) ? field : undefined,
          opaque: true,
        });
        return key;
      }
      case 'null_check': {
        const field = fieldNameOf(expr.expr) ?? render(expr.expr);
        // IS NULL and IS NOT NULL on the same field are exact complements.
        // Sharing one atom makes that free — no extra constraint needed.
        const key = `null:${field}`;
        this.add({
          key,
          kind: 'null_check',
          label: `${field} IS NULL`,
          field: this.captures.has(field) ? field : undefined,
          opaque: !this.captures.has(field),
        });
        const rec = this.nullChecks.get(field) ?? { isNull: [], notNull: [] };
        (expr.isNull ? rec.isNull : rec.notNull).push(key);
        this.nullChecks.set(field, rec);
        return key;
      }
      case 'contains':
        return this.add({
          key: `contains:${expr.predicateName}:${render(expr.subject)}`,
          kind: 'opaque',
          label: `${render(expr.subject)} ${expr.predicateName}`,
          opaque: true,
        });
      case 'matches':
        return this.add({
          key: `matches:${render(expr.subject)}:${
            expr.pattern.kind === 'identifier' ? expr.pattern.name : String(expr.pattern.value)
          }`,
          kind: 'opaque',
          label: `${render(expr.subject)} MATCHES ${
            expr.pattern.kind === 'identifier' ? expr.pattern.name : String(expr.pattern.value)
          }`,
          opaque: true,
        });
    }
    return null;
  }
}

// =============================================================================
// SOLVER — backtracking search with three-valued evaluation
// =============================================================================

type TriState = true | false | undefined;
type Assignment = Map<string, boolean>;

/**
 * Find an assignment satisfying every clause, or null if none exists.
 *
 * Depth-first over atoms with three-valued evaluation for pruning: as soon as
 * a partial assignment makes any clause definitely false, the branch is cut.
 * Numeric atoms get an interval feasibility check so that `charge > 500` and
 * `charge < 100` are recognised as jointly impossible rather than treated as
 * independent booleans.
 */
function solve(
  clauses: PredicateExpr[],
  ctx: AtomTable,
  pinned?: Assignment,
): Assignment | null {
  const assignment: Assignment = new Map(pinned ?? []);
  const atoms = ctx.list().map((a) => a.key).filter((k) => !assignment.has(k));

  const recurse = (i: number): boolean => {
    // Prune: any clause already false under the partial assignment?
    for (const c of clauses) {
      if (evalTri(c, assignment, ctx) === false) return false;
    }
    if (!numericFeasible(assignment, ctx)) return false;
    if (i >= atoms.length) {
      return clauses.every((c) => evalTri(c, assignment, ctx) === true);
    }
    const key = atoms[i]!;
    for (const value of [true, false]) {
      assignment.set(key, value);
      if (recurse(i + 1)) return true;
      assignment.delete(key);
    }
    return false;
  };

  return recurse(0) ? new Map(assignment) : null;
}

/** Three-valued evaluation: undefined means "not yet determined". */
function evalTri(expr: PredicateExpr, a: Assignment, ctx: AtomTable): TriState {
  switch (expr.kind) {
    case 'literal':
      return Boolean(expr.value);
    case 'parenthesized':
      return evalTri(expr.inner, a, ctx);
    case 'boolean': {
      if (expr.op === 'NOT') {
        const v = evalTri(expr.operands[0]!, a, ctx);
        return v === undefined ? undefined : !v;
      }
      if (expr.op === 'AND') {
        let sawUnknown = false;
        for (const op of expr.operands) {
          const v = evalTri(op, a, ctx);
          if (v === false) return false;
          if (v === undefined) sawUnknown = true;
        }
        return sawUnknown ? undefined : true;
      }
      // OR
      let sawUnknown = false;
      for (const op of expr.operands) {
        const v = evalTri(op, a, ctx);
        if (v === true) return true;
        if (v === undefined) sawUnknown = true;
      }
      return sawUnknown ? undefined : false;
    }
    case 'null_check': {
      const key = ctx.keyFor(expr);
      if (!key) return undefined;
      const v = a.get(key);
      if (v === undefined) return undefined;
      // The shared atom means "IS NULL"; IS NOT NULL is its negation.
      return expr.isNull ? v : !v;
    }
    case 'membership': {
      const key = ctx.keyFor(expr);
      if (!key) return undefined;
      const v = a.get(key);
      if (v === undefined) return undefined;
      return expr.negate ? !v : v;
    }
    default: {
      const key = ctx.keyFor(expr);
      if (!key) return undefined;
      const v = a.get(key);
      return v === undefined ? undefined : v;
    }
  }
}

/**
 * Interval consistency for numeric comparison atoms sharing a field.
 *
 * For a single numeric variable, a conjunction of interval constraints is
 * unsatisfiable exactly when the tightest lower bound exceeds the tightest
 * upper bound (or an equality falls outside them) — so this is complete for
 * the fragment, not a heuristic.
 */
function numericFeasible(a: Assignment, ctx: AtomTable): boolean {
  const byField = new Map<string, NumericConstraint[]>();
  for (const [key, value] of a) {
    const nc = ctx.numericFor(key);
    if (!nc) continue;
    // A false comparison atom is the negation of the constraint.
    const effective = value ? nc : negateConstraint(nc);
    const list = byField.get(nc.field) ?? [];
    list.push(effective);
    byField.set(nc.field, list);
  }

  for (const constraints of byField.values()) {
    let lo = -Infinity, loOpen = false;
    let hi = Infinity, hiOpen = false;
    const notEquals: number[] = [];
    let eq: number | undefined;

    for (const c of constraints) {
      switch (c.op) {
        case '>':  if (c.value >= lo) { lo = c.value; loOpen = true; } break;
        case '>=': if (c.value > lo || (c.value === lo && !loOpen)) { lo = c.value; loOpen = false; } break;
        case '<':  if (c.value <= hi) { hi = c.value; hiOpen = true; } break;
        case '<=': if (c.value < hi || (c.value === hi && !hiOpen)) { hi = c.value; hiOpen = false; } break;
        case '==':
          if (eq !== undefined && eq !== c.value) return false;
          eq = c.value;
          break;
        case '!=': notEquals.push(c.value); break;
      }
    }
    if (eq !== undefined) {
      if (eq < lo || (eq === lo && loOpen)) return false;
      if (eq > hi || (eq === hi && hiOpen)) return false;
      if (notEquals.includes(eq)) return false;
      continue;
    }
    if (lo > hi) return false;
    if (lo === hi && (loOpen || hiOpen)) return false;
    // A single excluded point can only empty the range if the range IS that point.
    if (lo === hi && notEquals.includes(lo)) return false;
  }
  return true;
}

function satisfiesConstraint(value: number, c: NumericConstraint): boolean {
  switch (c.op) {
    case '==': return value === c.value;
    case '!=': return value !== c.value;
    case '<':  return value < c.value;
    case '<=': return value <= c.value;
    case '>':  return value > c.value;
    case '>=': return value >= c.value;
  }
}

function negateConstraint(c: NumericConstraint): NumericConstraint {
  const flip: Record<NumericConstraint['op'], NumericConstraint['op']> = {
    '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<',
  };
  return { field: c.field, op: flip[c.op], value: c.value };
}

// =============================================================================
// EXPLANATIONS — minimal conflicts, redundancy, witnesses
// =============================================================================

/**
 * Shrink an unsatisfiable clause set to a minimal conflicting subset by
 * deletion: drop a clause, and if the rest is still unsatisfiable the dropped
 * one wasn't needed. What survives is a set where removing anything makes the
 * point admit events again — the actual repair site.
 */
function minimalConflict(
  clauses: Array<{ name: string; expr: PredicateExpr }>,
  ctx: AtomTable,
  pinned?: Assignment,
): string[] {
  let core = [...clauses];
  for (const candidate of [...core]) {
    const without = core.filter((c) => c !== candidate);
    if (without.length > 0 && solve(without.map((c) => c.expr), ctx, pinned) === null) {
      core = without;
    }
  }
  return core.map((c) => c.name);
}

/**
 * Look for whole classes of event that can never be admitted.
 *
 * A point can be satisfiable — something gets through — while an entire
 * category is impossible. Two rules added months apart, each sensible, can
 * between them mean "no claim with units >= 2 will ever pass again". Nothing
 * contradicts globally, so the satisfiability check stays green, and a
 * regression replay only notices if the corpus happens to hold that category.
 *
 * The scan pins one field at a time and re-solves:
 *   - boolean captures: pin true, then false
 *   - numeric captures: pin to each side of every threshold the program
 *     mentions, so `units < 2` yields the classes `units < 2` and `units >= 2`
 *
 * One field at a time keeps this cheap and keeps the finding legible — a
 * two-field class is real but nobody can act on "no claim where A and not B".
 */
function findDeadClasses(
  clauses: Array<{ name: string; expr: PredicateExpr }>,
  ctx: AtomTable,
  point: InspectionPointDecl,
): DeadClass[] {
  const out: DeadClass[] = [];
  const exprs = clauses.map((c) => c.expr);

  for (const capture of point.captures) {
    if (capture.type === 'bool') {
      for (const value of [true, false]) {
        const pin = ctx.pinBoolean(capture.name, value);
        if (!pin) continue;
        if (solve(exprs, ctx, pin) === null) {
          out.push({
            field: capture.name,
            value,
            label: `${capture.name} = ${value}`,
            ...withEmergence(minimalConflict(clauses, ctx, pin)),
          });
        }
      }
      continue;
    }
    if (capture.type === 'number' || capture.type === 'float') {
      for (const { label, value, pin } of ctx.numericClasses(capture.name)) {
        if (solve(exprs, ctx, pin) === null) {
          out.push({ field: capture.name, value, label, ...withEmergence(minimalConflict(clauses, ctx, pin)) });
        }
      }
    }
  }
  return out;
}

function withEmergence(conflict: string[]): { conflict: string[]; emergent: boolean } {
  return { conflict, emergent: conflict.length > 1 };
}

/** A clause is redundant when the others already imply it. */
function findRedundant(
  clauses: Array<{ name: string; expr: PredicateExpr }>,
  ctx: AtomTable,
): string[] {
  if (clauses.length < 2) return [];
  const out: string[] = [];
  for (const candidate of clauses) {
    const others = clauses.filter((c) => c !== candidate).map((c) => c.expr);
    // others ∧ ¬candidate unsatisfiable  ⇔  others ⊨ candidate
    const probe: PredicateExpr = { kind: 'boolean', op: 'NOT', operands: [candidate.expr] };
    if (solve([...others, probe], ctx) === null) out.push(candidate.name);
  }
  return out;
}

function buildWitness(a: Assignment, ctx: AtomTable, point: InspectionPointDecl): Witness {
  const payload = defaultPayload(point);
  const assumptions: Witness['assumptions'] = [];
  const numericByField = new Map<string, NumericConstraint[]>();

  for (const atom of ctx.list()) {
    const value = a.get(atom.key);
    if (value === undefined) continue;
    if (atom.kind === 'comparison') {
      const nc = ctx.numericFor(atom.key);
      if (nc) {
        const list = numericByField.get(nc.field) ?? [];
        list.push(value ? nc : negateConstraint(nc));
        numericByField.set(nc.field, list);
      }
      continue;
    }
    if (atom.opaque) {
      assumptions.push({ label: atom.label, value });
      continue;
    }
    if (atom.kind === 'boolean' && atom.field) payload[atom.field] = value;
    if (atom.kind === 'null_check' && atom.field) {
      if (value) payload[atom.field] = null;
    }
  }

  // Pick a concrete number inside each field's feasible range.
  for (const [field, constraints] of numericByField) {
    payload[field] = pickNumber(constraints);
  }
  return { payload, assumptions };
}

function pickNumber(constraints: NumericConstraint[]): number {
  let lo = -Infinity, loOpen = false;
  let hi = Infinity, hiOpen = false;
  for (const c of constraints) {
    if (c.op === '==') return c.value;
    if (c.op === '>' && c.value >= lo) { lo = c.value; loOpen = true; }
    if (c.op === '>=' && c.value > lo) { lo = c.value; loOpen = false; }
    if (c.op === '<' && c.value <= hi) { hi = c.value; hiOpen = true; }
    if (c.op === '<=' && c.value < hi) { hi = c.value; hiOpen = false; }
  }
  if (lo === -Infinity && hi === Infinity) return 0;
  if (lo === -Infinity) return hiOpen ? hi - 1 : hi;
  if (hi === Infinity) return loOpen ? lo + 1 : lo;
  const mid = (lo + hi) / 2;
  return Number.isFinite(mid) ? mid : lo;
}

function defaultPayload(point: InspectionPointDecl): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of point.captures) {
    out[c.name] = c.type === 'bool' ? false : c.type === 'number' || c.type === 'float' ? 0 : '';
  }
  return out;
}

// =============================================================================
// HELPERS
// =============================================================================

function fieldNameOf(expr: PredicateExpr): string | undefined {
  if (expr.kind === 'identifier') return expr.name;
  if (expr.kind === 'field_path') return expr.segments.join('.');
  if (expr.kind === 'parenthesized') return fieldNameOf(expr.inner);
  return undefined;
}

function literalOf(expr: PredicateExpr): string | number | boolean | null | undefined {
  if (expr.kind === 'literal') return expr.value;
  if (expr.kind === 'parenthesized') return literalOf(expr.inner);
  return undefined;
}

function render(expr: PredicateExpr): string {
  switch (expr.kind) {
    case 'identifier': return expr.name;
    case 'field_path': return expr.segments.join('.');
    case 'literal': return String(expr.value);
    case 'parenthesized': return render(expr.inner);
    default: return expr.kind;
  }
}
