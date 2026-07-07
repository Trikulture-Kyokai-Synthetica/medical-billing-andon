// Predicate evaluator
//
// Walks a PredicateExpr AST against an event payload and a PredicateRegistry.
// Returns a boolean. Predicate language is intentionally not Turing-complete:
// no loops, no recursion, no arbitrary computation. Every evaluation is O(size
// of the predicate expression).

import type { PredicateExpr, FieldPath } from '../../qc-parser/src/index.js';
import type { PredicateRegistry } from './predicate-registry.js';

export function evaluatePredicate(
  expr: PredicateExpr,
  payload: Record<string, unknown>,
  registry: PredicateRegistry
): boolean {
  switch (expr.kind) {
    case 'literal':
      return Boolean(expr.value);
    case 'identifier': {
      // Boolean position: a bare identifier is a named-predicate reference
      // (e.g. `REQUIRES injection_pattern_detected`). A REGISTERED predicate
      // takes precedence over a payload field of the same name — otherwise an
      // (attacker-influenced) payload could shadow a real check by supplying
      // e.g. `injection_pattern_detected: false` and neutralize the gate.
      if (registry.hasNamedPredicate(expr.name)) {
        return registry.namedPredicate(expr.name, payload);
      }
      // Not a registered predicate — treat as a plain payload field truthy
      // check. If the field is also absent, namedPredicate throws
      // (UnresolvedReferenceError) and the runtime fails the construct closed.
      const resolved = resolveFieldOrNamed(expr.name, payload, registry);
      if (resolved === undefined) {
        return registry.namedPredicate(expr.name, payload);
      }
      return Boolean(resolved);
    }
    case 'field_path':
      return Boolean(resolveFieldPath(expr, payload));
    case 'comparison': {
      const left = evaluateValue(expr.left, payload, registry);
      const right = evaluateValue(expr.right, payload, registry);
      switch (expr.op) {
        case '==':
          return left === right || normalizeEquals(left) === normalizeEquals(right);
        case '!=':
          return left !== right && normalizeEquals(left) !== normalizeEquals(right);
        case '<':
          return toNumberOrNaN(left) < toNumberOrNaN(right);
        case '<=':
          return toNumberOrNaN(left) <= toNumberOrNaN(right);
        case '>':
          return toNumberOrNaN(left) > toNumberOrNaN(right);
        case '>=':
          return toNumberOrNaN(left) >= toNumberOrNaN(right);
      }
      return false;
    }
    case 'membership': {
      const value = evaluateValue(expr.value, payload, registry);
      // Throws UnresolvedReferenceError if the set isn't registered — the
      // runtime catches it and fails the enclosing construct closed rather
      // than treating an unknown allowlist as "everything is allowed".
      const inSet = registry.setMembership(expr.set.name, value);
      return expr.negate ? !inSet : inSet;
    }
    case 'null_check': {
      const value = evaluateValue(expr.expr, payload, registry);
      const isNullish = value === null || value === undefined;
      return expr.isNull ? isNullish : !isNullish;
    }
    case 'contains': {
      const subject = evaluateValue(expr.subject, payload, registry);
      const found = registry.contains(expr.predicateName, subject);
      if (!found) return false;
      // NOT MATCHING <reference>: the subject contains the pattern AND does
      // NOT match the named reference. Used for things like:
      //   response_text CONTAINS_FULL_ADDRESS NOT MATCHING current_customer
      // meaning: contains an address that isn't the current customer's.
      if (expr.notMatching) {
        const reference = payload[expr.notMatching.name];
        if (reference !== undefined && asString(subject).includes(asString(reference))) {
          return false;
        }
      }
      return true;
    }
    case 'matches': {
      // If the pattern is an identifier, treat it as a named predicate —
      // the predicate function decides whether the subject matches. This
      // is how schema-validation predicates like `tool_schema` are wired in.
      if (expr.pattern.kind === 'identifier') {
        return registry.namedPredicate(expr.pattern.name, payload);
      }
      // Otherwise the pattern is a literal — substring match against the
      // subject coerced to string.
      const subject = evaluateValue(expr.subject, payload, registry);
      const pattern = expr.pattern.value;
      if (typeof pattern === 'string') {
        return asString(subject).includes(pattern);
      }
      return subject !== undefined && subject !== null;
    }
    case 'boolean': {
      switch (expr.op) {
        case 'AND':
          return expr.operands.every((op) => evaluatePredicate(op, payload, registry));
        case 'OR':
          return expr.operands.some((op) => evaluatePredicate(op, payload, registry));
        case 'NOT':
          return !evaluatePredicate(expr.operands[0]!, payload, registry);
      }
      return false;
    }
    case 'parenthesized':
      return evaluatePredicate(expr.inner, payload, registry);
  }
}

// --- Evaluate an expression as a value rather than a boolean ---
// Used when an expression appears as the LHS or RHS of comparison/membership/etc.

function evaluateValue(
  expr: PredicateExpr,
  payload: Record<string, unknown>,
  registry: PredicateRegistry
): unknown {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'identifier':
      return resolveFieldOrNamed(expr.name, payload, registry);
    case 'field_path':
      return resolveFieldPath(expr, payload);
    default:
      // Nested boolean expressions as values — treat as boolean
      return evaluatePredicate(expr, payload, registry);
  }
}

function resolveFieldOrNamed(
  name: string,
  payload: Record<string, unknown>,
  _registry: PredicateRegistry
): unknown {
  if (Object.prototype.hasOwnProperty.call(payload, name)) {
    return payload[name];
  }
  return undefined;
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

// --- Helpers ---

function toNumberOrNaN(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? NaN : n;
  }
  return NaN;
}

function normalizeEquals(value: unknown): unknown {
  if (typeof value === 'number') return String(value);
  return value;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}
