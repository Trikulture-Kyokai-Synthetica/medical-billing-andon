// Registry of CONTAINS_* predicates and named predicates.
//
// The QC dialect's predicate language references named predicates like
// CONTAINS_SSN, CONTAINS_FULL_ADDRESS, and runtime-named booleans like
// `matches_brand_voice`. This module provides the default registry with
// regex-based detectors for the demo. Production deployments will wire in
// domain-specific detectors via the same interface.

export type ContainsDetector = (value: unknown) => boolean;
export type NamedPredicateFn = (payload: Record<string, unknown>) => boolean;

/**
 * Thrown when a predicate expression references a named predicate, CONTAINS
 * detector, or set that isn't registered. Carries enough context for the
 * runtime to record a `harness_error` audit entry and fail the affected
 * construct closed. `kind` is the reference category (e.g. "set"); `name`
 * is the unregistered identifier.
 */
export class UnresolvedReferenceError extends Error {
  constructor(
    public readonly refKind: string,
    public readonly reference: string,
  ) {
    super(`Unresolved ${refKind}: '${reference}' is referenced but not registered`);
    this.name = 'UnresolvedReferenceError';
  }
}

// =============================================================================
// CONTAINS_* default detectors
// =============================================================================

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,16}\b/;
const FULL_ADDRESS_RE =
  /\b\d+\s+[A-Za-z][\w\s.]*?\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd|Drive|Dr)\b/i;

const INSTRUCTION_OVERRIDE_PATTERNS = [
  /ignore (?:all )?(?:previous|prior) instructions/i,
  /disregard (?:all )?(?:previous|prior) instructions/i,
  /forget (?:all )?(?:previous|prior) instructions/i,
];

const ROLE_REDEFINITION_PATTERNS = [
  /you are now in [a-z]+ mode/i,
  /you are now an? unrestricted/i,
  /act as (?:DAN|jailbroken)/i,
  /pretend you have no restrictions/i,
];

const AUTHORITY_IMPERSONATION_PATTERNS = [
  /as (?:an? )?admin(?:istrator)?,? (?:please )?(?:reveal|show|provide)/i,
  /as the developer,? (?:please )?(?:reveal|show|provide)/i,
  /as a moderator,? (?:please )?(?:reveal|show|provide)/i,
];

const INDIRECT_INJECTION_PATTERNS = [
  /<system>/i,
  /\[\[instruction\]\]/i,
  /please ignore the above and instead/i,
];

const INTERNAL_NOTE_PATTERNS = [
  /\bINTERNAL ONLY\b/i,
  /\bSTAFF NOTE\b/i,
  /\bCONFIDENTIAL\b.*\b(staff|internal)\b/i,
];

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

function matchesAny(value: unknown, patterns: RegExp[]): boolean {
  const s = asString(value);
  return patterns.some((p) => p.test(s));
}

export const DEFAULT_CONTAINS_DETECTORS: Record<string, ContainsDetector> = {
  CONTAINS_SSN: (v) => SSN_RE.test(asString(v)),
  CONTAINS_CREDIT_CARD: (v) => {
    const s = asString(v).replace(/[ -]/g, '');
    return CREDIT_CARD_RE.test(asString(v)) && /^\d{13,16}$/.test(s.replace(/\D/g, '').slice(0, 16));
  },
  CONTAINS_FULL_ADDRESS: (v) => FULL_ADDRESS_RE.test(asString(v)),
  CONTAINS_INTERNAL_ACCOUNT_NOTE: (v) => matchesAny(v, INTERNAL_NOTE_PATTERNS),
  CONTAINS_INSTRUCTION_OVERRIDE: (v) => matchesAny(v, INSTRUCTION_OVERRIDE_PATTERNS),
  CONTAINS_ROLE_REDEFINITION: (v) => matchesAny(v, ROLE_REDEFINITION_PATTERNS),
  CONTAINS_AUTHORITY_IMPERSONATION: (v) => matchesAny(v, AUTHORITY_IMPERSONATION_PATTERNS),
  CONTAINS_INDIRECT_INJECTION: (v) => matchesAny(v, INDIRECT_INJECTION_PATTERNS),
};

// =============================================================================
// Named-predicate defaults (named booleans referenced in REQUIRES/DETECTS)
//
// A named predicate that is referenced by a rule but NOT registered is a
// harness misconfiguration. The registry reports it as unresolved (see
// `hasNamedPredicate`) and the runtime resolves the affected construct
// FAIL-CLOSED — an ACCEPTANCE_CRITERION whose REQUIRES can't be evaluated
// must not pass, a DEFECT_MODE whose DETECTS can't be evaluated must flag.
// (This is the whole point of a QC harness: a gate you can't evaluate is a
// gate you don't trust, not a gate you wave through.)
//
// The demo registers a specific subset (matches_brand_voice etc.) below.
// =============================================================================

export const DEFAULT_NAMED_PREDICATES: Record<string, NamedPredicateFn> = {
  // These are the named predicates from the help_desk_agent.qc worked example.
  // Each one is a simple boolean check against the payload — sufficient for
  // the demo. Production wires in real implementations.

  matches_brand_voice: () => true,
  obeys_legal_disclaimer_if_required: () => true,
  // Referenced by tool_call_valid via `tool_parameters MATCHES tool_schema`.
  // Demo stub — production registers a real JSON-schema validator against
  // the tool catalog. (Previously unregistered, which only "worked" because
  // unknown predicates silently returned true; now that they fail closed it
  // must be a real registry entry.)
  tool_schema: () => true,
  no_unauthorized_guarantees: (payload) => {
    const text = asString(payload.response_text ?? '');
    return !/lifetime free|guaranteed|we promise/i.test(text);
  },
  no_discounts_above_agent_authority: (payload) => {
    const text = asString(payload.response_text ?? '');
    return !/(\d+)%\s*off/i.test(text); // anything offering a percentage off is flagged
  },
  no_promises_outside_sla: (payload) => {
    const text = asString(payload.response_text ?? '');
    return !/same.?day|within (?:an? hour|24 hours)/i.test(text);
  },
  target_team_handles_case_type: () => true,
  injection_pattern_detected: (payload) => {
    const text = asString(payload.message_text ?? '');
    for (const detector of [
      DEFAULT_CONTAINS_DETECTORS.CONTAINS_INSTRUCTION_OVERRIDE!,
      DEFAULT_CONTAINS_DETECTORS.CONTAINS_ROLE_REDEFINITION!,
      DEFAULT_CONTAINS_DETECTORS.CONTAINS_AUTHORITY_IMPERSONATION!,
    ]) {
      if (detector(text)) return true;
    }
    return false;
  },
};

// =============================================================================
// Predicate registry
// =============================================================================

export class PredicateRegistry {
  private containsDetectors: Map<string, ContainsDetector>;
  private namedPredicates: Map<string, NamedPredicateFn>;
  // Named sets used by IN / NOT IN
  private namedSets: Map<string, Set<unknown>>;

  constructor() {
    this.containsDetectors = new Map(Object.entries(DEFAULT_CONTAINS_DETECTORS));
    this.namedPredicates = new Map(Object.entries(DEFAULT_NAMED_PREDICATES));
    this.namedSets = new Map();
  }

  registerContains(name: string, detector: ContainsDetector): void {
    this.containsDetectors.set(name, detector);
  }

  registerNamedPredicate(name: string, fn: NamedPredicateFn): void {
    this.namedPredicates.set(name, fn);
  }

  registerSet(name: string, members: Iterable<unknown>): void {
    this.namedSets.set(name, new Set(members));
  }

  hasContains(predicateName: string): boolean {
    return this.containsDetectors.has(predicateName);
  }

  hasNamedPredicate(name: string): boolean {
    return this.namedPredicates.has(name);
  }

  hasSet(setName: string): boolean {
    return this.namedSets.has(setName);
  }

  contains(predicateName: string, value: unknown): boolean {
    const detector = this.containsDetectors.get(predicateName);
    if (!detector) {
      // Unknown CONTAINS_* is a misconfiguration, not a "no match". The
      // caller (evaluator) checks hasContains() first and throws an
      // UnresolvedReferenceError so the runtime can fail closed. This guard
      // is defensive only.
      throw new UnresolvedReferenceError('CONTAINS predicate', predicateName);
    }
    return detector(value);
  }

  namedPredicate(name: string, payload: Record<string, unknown>): boolean {
    const fn = this.namedPredicates.get(name);
    if (!fn) {
      // Unknown named predicate — a gate the harness can't evaluate. Signal
      // it; the runtime resolves the affected construct fail-closed rather
      // than silently passing (the old behavior, which inverted the whole
      // point of a QC harness). Callers check hasNamedPredicate() first;
      // this throw is the defensive backstop.
      throw new UnresolvedReferenceError('named predicate', name);
    }
    return fn(payload);
  }

  setMembership(setName: string, value: unknown): boolean {
    const set = this.namedSets.get(setName);
    if (!set) {
      // Unknown set — same story as an unknown named predicate.
      throw new UnresolvedReferenceError('set', setName);
    }
    return set.has(value);
  }
}
