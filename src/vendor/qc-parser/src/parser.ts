// Agicore QC Dialect Parser
//
// Consumes the token stream produced by the lexer and produces a typed AST.
// See agicore/dsl/qc-grammar.md for the grammar specification.

import {
  Lexer,
  type Token,
  TokenType,
} from './lexer.js';
import type {
  QcFile,
  QcDeclaration,
  ControlPlanDecl,
  ControlPlanEnumeration,
  InspectionPointDecl,
  ControlLimitDecl,
  SpcChartDecl,
  DefectModeDecl,
  AcceptanceCriterionDecl,
  PokaYokeDecl,
  AndonDecl,
  AiHarnessDecl,
  AuditTrailDecl,
  ProductionSystemDecl,
  CaptureField,
  Scope,
  SourceLocation,
  SourceSpan,
  QcPrimitiveType,
  PredicateExpr,
  TriggerAction,
  AndonRef,
  ProposeReviewRef,
  RecoveryAction,
  SeverityLevel,
  ChartType,
  WesternElectricRuleSet,
  ColorTag,
  AuditLevel,
  AccessLevel,
  PermittedObservation,
  PermittedProposal,
  StorageMode,
  ExportFormat,
  TimestampPrecision,
  ProvenanceChainMode,
  TamperEvidentMode,
  SandboxMode,
  SystemKind,
  EventBridgeKind,
  CaptureClass,
  Duration,
  FieldPath,
  IdentifierRef,
  LiteralValue,
} from './types.js';

// --- ParseError ---

export class ParseError extends Error {
  constructor(
    message: string,
    public location: SourceLocation,
    public hint?: string
  ) {
    const hintSuffix = hint ? ` (${hint})` : '';
    super(
      `Parse error at line ${location.line}, column ${location.column}: ${message}${hintSuffix}`
    );
    this.name = 'ParseError';
  }
}

// --- Standard forbidden actions enforced regardless of declaration ---

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

// --- Parser ---

export class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(source: string): QcFile {
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
    this.pos = 0;

    const declarations: QcDeclaration[] = [];
    while (!this.isAtEnd()) {
      declarations.push(this.parseTopLevelDeclaration());
    }

    return this.assembleFile(declarations);
  }

  // --- Top-level dispatch ---

  private parseTopLevelDeclaration(): QcDeclaration {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.CONTROL_PLAN:
        return this.parseControlPlan();
      case TokenType.INSPECTION_POINT:
        return this.parseInspectionPoint();
      case TokenType.CONTROL_LIMIT:
        return this.parseControlLimit();
      case TokenType.SPC_CHART:
        return this.parseSpcChart();
      case TokenType.DEFECT_MODE:
        return this.parseDefectMode();
      case TokenType.ACCEPTANCE_CRITERION:
        return this.parseAcceptanceCriterion();
      case TokenType.POKA_YOKE:
        return this.parsePokaYoke();
      case TokenType.ANDON:
        return this.parseAndon();
      case TokenType.AI_HARNESS:
        return this.parseAiHarness();
      case TokenType.AUDIT_TRAIL:
        return this.parseAuditTrail();
      case TokenType.PRODUCTION_SYSTEM:
        return this.parseProductionSystem();
      default:
        throw new ParseError(
          `Expected a top-level declaration keyword, got '${tok.value}' (${tok.type})`,
          tok.location,
          'expected CONTROL_PLAN, INSPECTION_POINT, CONTROL_LIMIT, SPC_CHART, DEFECT_MODE, ACCEPTANCE_CRITERION, POKA_YOKE, ANDON, AI_HARNESS, AUDIT_TRAIL, or PRODUCTION_SYSTEM'
        );
    }
  }

  // =============================================================================
  // CONTROL_PLAN
  // =============================================================================

  private parseControlPlan(): ControlPlanDecl {
    const startTok = this.expect(TokenType.CONTROL_PLAN);
    const name = this.expectIdentifier('control plan name');
    this.expect(TokenType.LBRACE);

    let title: string | null = null;
    let version: string | null = null;
    let description: string | null = null;
    let productionSystem: string | null = null;
    let authority: string | null = null;
    let auditTrail: string | null = null;
    let aiHarness: string | null = null;
    const enumerations: ControlPlanEnumeration[] = [];

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.TITLE:
          this.advance();
          title = this.expectStringLiteral('TITLE value');
          break;
        case TokenType.VERSION:
          this.advance();
          version = this.expectStringLiteral('VERSION value');
          break;
        case TokenType.DESCRIPTION:
          this.advance();
          description = this.expectStringLiteral('DESCRIPTION value');
          break;
        case TokenType.PRODUCTION_SYSTEM:
          this.advance();
          productionSystem = this.expectIdentifier('PRODUCTION_SYSTEM reference');
          break;
        case TokenType.AUTHORITY:
          this.advance();
          authority = this.expectDottedIdentifier('AUTHORITY');
          break;
        case TokenType.AUDIT_TRAIL:
          this.advance();
          auditTrail = this.expectIdentifier('AUDIT_TRAIL reference');
          break;
        case TokenType.AI_HARNESS:
          this.advance();
          aiHarness = this.expectIdentifier('AI_HARNESS reference');
          break;
        case TokenType.INSPECTION_POINTS:
        case TokenType.CONTROL_LIMITS:
        case TokenType.SPC_CHARTS:
        case TokenType.DEFECT_MODES:
        case TokenType.ACCEPTANCE_CRITERIA:
        case TokenType.POKA_YOKES:
        case TokenType.ANDONS:
          enumerations.push(this.parseControlPlanEnumeration());
          break;
        default:
          throw new ParseError(
            `Unexpected token in CONTROL_PLAN body: '${tok.value}' (${tok.type})`,
            tok.location,
            'expected TITLE, VERSION, DESCRIPTION, PRODUCTION_SYSTEM, AUTHORITY, AUDIT_TRAIL, AI_HARNESS, or an enumeration block'
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (title === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field TITLE`,
        startTok.location
      );
    if (version === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field VERSION`,
        startTok.location
      );
    if (description === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field DESCRIPTION`,
        startTok.location
      );
    if (productionSystem === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field PRODUCTION_SYSTEM`,
        startTok.location
      );
    if (authority === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field AUTHORITY`,
        startTok.location
      );
    if (auditTrail === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field AUDIT_TRAIL`,
        startTok.location
      );
    if (aiHarness === null)
      throw new ParseError(
        `CONTROL_PLAN '${name}' is missing required field AI_HARNESS`,
        startTok.location
      );

    return {
      kind: 'CONTROL_PLAN',
      name,
      title,
      version,
      description,
      productionSystem,
      authority,
      enumerations,
      auditTrail,
      aiHarness,
      location: this.span(startTok.location, endTok.location),
    };
  }

  private parseControlPlanEnumeration(): ControlPlanEnumeration {
    const tok = this.advance();
    const kindMap: Record<string, ControlPlanEnumeration['kind']> = {
      [TokenType.INSPECTION_POINTS]: 'INSPECTION_POINTS',
      [TokenType.CONTROL_LIMITS]: 'CONTROL_LIMITS',
      [TokenType.SPC_CHARTS]: 'SPC_CHARTS',
      [TokenType.DEFECT_MODES]: 'DEFECT_MODES',
      [TokenType.ACCEPTANCE_CRITERIA]: 'ACCEPTANCE_CRITERIA',
      [TokenType.POKA_YOKES]: 'POKA_YOKES',
      [TokenType.ANDONS]: 'ANDONS',
    };
    const kind = kindMap[tok.type];
    if (!kind) {
      throw new ParseError(
        `Unexpected enumeration kind: '${tok.value}'`,
        tok.location
      );
    }

    this.expect(TokenType.LBRACE);
    const members: string[] = [];
    while (!this.check(TokenType.RBRACE)) {
      const memberTok = this.peek();
      if (memberTok.type === TokenType.IDENTIFIER) {
        members.push(memberTok.value);
        this.advance();
      } else {
        throw new ParseError(
          `Expected identifier in ${kind} enumeration, got '${memberTok.value}' (${memberTok.type})`,
          memberTok.location
        );
      }
    }
    this.expect(TokenType.RBRACE);

    return { kind, members };
  }

  // =============================================================================
  // INSPECTION_POINT
  // =============================================================================

  private parseInspectionPoint(): InspectionPointDecl {
    const startTok = this.expect(TokenType.INSPECTION_POINT);
    const name = this.expectIdentifier('inspection point name');
    this.expect(TokenType.LBRACE);

    let captures: CaptureField[] | null = null;
    let scope: Scope | null = null;
    let streamsTo: string | undefined = undefined;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.CAPTURES:
          this.advance();
          captures = this.parseCaptureSchema();
          break;
        case TokenType.SCOPE:
          this.advance();
          scope = this.parseScopeValue();
          break;
        case TokenType.STREAMS_TO:
          this.advance();
          streamsTo = this.expectIdentifier('STREAMS_TO target');
          break;
        default:
          throw new ParseError(
            `Unexpected token in INSPECTION_POINT body: '${tok.value}' (${tok.type})`,
            tok.location,
            'expected CAPTURES, SCOPE, or STREAMS_TO'
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (captures === null) {
      throw new ParseError(
        `INSPECTION_POINT '${name}' is missing required field CAPTURES`,
        startTok.location
      );
    }
    if (scope === null) {
      throw new ParseError(
        `INSPECTION_POINT '${name}' is missing required field SCOPE`,
        startTok.location
      );
    }

    return {
      kind: 'INSPECTION_POINT',
      name,
      captures,
      scope,
      streamsTo,
      location: this.span(startTok.location, endTok.location),
    };
  }

  private parseCaptureSchema(): CaptureField[] {
    const fields: CaptureField[] = [];
    do {
      const startTok = this.peek();
      const fieldName = this.expectIdentifier('capture field name');
      this.expect(TokenType.COLON);
      const fieldType = this.parsePrimitiveType();
      const endLoc = this.previous().location;
      fields.push({
        name: fieldName,
        type: fieldType,
        location: this.span(startTok.location, endLoc),
      });
      if (this.check(TokenType.COMMA)) {
        this.advance();
      } else {
        break;
      }
    } while (true);
    return fields;
  }

  private parsePrimitiveType(): QcPrimitiveType {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.STRING:
        return 'string';
      case TokenType.NUMBER:
        return 'number';
      case TokenType.FLOAT:
        return 'float';
      case TokenType.BOOL:
        return 'bool';
      case TokenType.DATE:
        return 'date';
      case TokenType.DATETIME:
        return 'datetime';
      case TokenType.JSON:
        return 'json';
      case TokenType.ID:
        return 'id';
      default:
        throw new ParseError(
          `Expected a primitive type (string, number, float, bool, date, datetime, json, id), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseScopeValue(): Scope {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.CUSTOMER_FACING:
        return 'customer-facing';
      case TokenType.INTERNAL:
        return 'internal';
      case TokenType.PRE_EMISSION:
        return 'pre-emission';
      case TokenType.POST_EMISSION:
        return 'post-emission';
      default:
        throw new ParseError(
          `Expected SCOPE value (customer-facing | internal | pre-emission | post-emission), got '${tok.value}'`,
          tok.location
        );
    }
  }

  // =============================================================================
  // CONTROL_LIMIT
  // =============================================================================

  private parseControlLimit(): ControlLimitDecl {
    const startTok = this.expect(TokenType.CONTROL_LIMIT);
    const name = this.expectIdentifier('control limit name');
    this.expect(TokenType.LBRACE);

    let point: string | null = null;
    let when: PredicateExpr | undefined = undefined;
    let measure: FieldPath | null = null;
    let upper: number | undefined = undefined;
    let lower: number | undefined = undefined;
    let onViolation: TriggerAction | null = null;
    let auditVerbose = false;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.POINT:
          this.advance();
          point = this.expectIdentifier('POINT reference');
          break;
        case TokenType.WHEN:
          this.advance();
          when = this.parsePredicate();
          break;
        case TokenType.MEASURE:
          this.advance();
          measure = this.parseFieldPath();
          break;
        case TokenType.UPPER:
          this.advance();
          upper = this.expectNumber('UPPER value');
          break;
        case TokenType.LOWER:
          this.advance();
          lower = this.expectNumber('LOWER value');
          break;
        case TokenType.ON_VIOLATION:
          this.advance();
          onViolation = this.parseTriggerAction();
          break;
        case TokenType.AUDIT_VERBOSE:
          this.advance();
          auditVerbose = this.expectBoolean('AUDIT_VERBOSE value');
          break;
        default:
          throw new ParseError(
            `Unexpected token in CONTROL_LIMIT body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (point === null)
      throw new ParseError(`CONTROL_LIMIT '${name}' is missing required field POINT`, startTok.location);
    if (measure === null)
      throw new ParseError(`CONTROL_LIMIT '${name}' is missing required field MEASURE`, startTok.location);
    if (upper === undefined && lower === undefined)
      throw new ParseError(`CONTROL_LIMIT '${name}' must have at least one of UPPER or LOWER`, startTok.location);
    if (onViolation === null)
      throw new ParseError(`CONTROL_LIMIT '${name}' is missing required field ON_VIOLATION`, startTok.location);

    return {
      kind: 'CONTROL_LIMIT',
      name,
      point,
      when,
      measure,
      upper,
      lower,
      onViolation,
      auditVerbose,
      location: this.span(startTok.location, endTok.location),
    };
  }

  // =============================================================================
  // SPC_CHART
  // =============================================================================

  private parseSpcChart(): SpcChartDecl {
    const startTok = this.expect(TokenType.SPC_CHART);
    const name = this.expectIdentifier('SPC chart name');
    this.expect(TokenType.LBRACE);

    let point: string | null = null;
    let when: PredicateExpr | undefined = undefined;
    let measure: FieldPath | null = null;
    let chartType: ChartType | null = null;
    let sampleSize: number | null = null;
    let westernElectric: WesternElectricRuleSet | null = null;
    let onRuleViolation: TriggerAction | null = null;
    let audit = false;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.POINT:
          this.advance();
          point = this.expectIdentifier('POINT reference');
          break;
        case TokenType.WHEN:
          this.advance();
          when = this.parsePredicate();
          break;
        case TokenType.MEASURE:
          this.advance();
          measure = this.parseFieldPath();
          break;
        case TokenType.CHART_TYPE:
          this.advance();
          chartType = this.parseChartType();
          break;
        case TokenType.SAMPLE_SIZE:
          this.advance();
          sampleSize = this.expectInteger('SAMPLE_SIZE value');
          break;
        case TokenType.WESTERN_ELECTRIC:
          this.advance();
          westernElectric = this.parseWesternElectric();
          break;
        case TokenType.ON_RULE_VIOLATION:
          this.advance();
          onRuleViolation = this.parseTriggerAction();
          break;
        case TokenType.AUDIT:
          this.advance();
          audit = this.expectBoolean('AUDIT value');
          break;
        default:
          throw new ParseError(
            `Unexpected token in SPC_CHART body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (point === null)
      throw new ParseError(`SPC_CHART '${name}' is missing required field POINT`, startTok.location);
    if (measure === null)
      throw new ParseError(`SPC_CHART '${name}' is missing required field MEASURE`, startTok.location);
    if (chartType === null)
      throw new ParseError(`SPC_CHART '${name}' is missing required field CHART_TYPE`, startTok.location);
    if (sampleSize === null)
      throw new ParseError(`SPC_CHART '${name}' is missing required field SAMPLE_SIZE`, startTok.location);
    if (westernElectric === null)
      throw new ParseError(`SPC_CHART '${name}' is missing required field WESTERN_ELECTRIC`, startTok.location);
    if (onRuleViolation === null)
      throw new ParseError(`SPC_CHART '${name}' is missing required field ON_RULE_VIOLATION`, startTok.location);

    return {
      kind: 'SPC_CHART',
      name,
      point,
      when,
      measure,
      chartType,
      sampleSize,
      westernElectric,
      onRuleViolation,
      audit,
      location: this.span(startTok.location, endTok.location),
    };
  }

  // =============================================================================
  // DEFECT_MODE
  // =============================================================================

  private parseDefectMode(): DefectModeDecl {
    const startTok = this.expect(TokenType.DEFECT_MODE);
    const name = this.expectIdentifier('defect mode name');
    this.expect(TokenType.LBRACE);

    let point: string | null = null;
    let detects: PredicateExpr | null = null;
    let severity: SeverityLevel | null = null;
    let onDetect: TriggerAction | null = null;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.POINT:
          this.advance();
          point = this.expectIdentifier('POINT reference');
          break;
        case TokenType.DETECTS:
          this.advance();
          detects = this.parsePredicate();
          break;
        case TokenType.SEVERITY:
          this.advance();
          severity = this.parseSeverity();
          break;
        case TokenType.ON_DETECT:
          this.advance();
          onDetect = this.parseTriggerAction();
          break;
        default:
          throw new ParseError(
            `Unexpected token in DEFECT_MODE body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (point === null)
      throw new ParseError(`DEFECT_MODE '${name}' is missing required field POINT`, startTok.location);
    if (detects === null)
      throw new ParseError(`DEFECT_MODE '${name}' is missing required field DETECTS`, startTok.location);
    if (severity === null)
      throw new ParseError(`DEFECT_MODE '${name}' is missing required field SEVERITY`, startTok.location);
    if (onDetect === null)
      throw new ParseError(`DEFECT_MODE '${name}' is missing required field ON_DETECT`, startTok.location);

    return {
      kind: 'DEFECT_MODE',
      name,
      point,
      detects,
      severity,
      onDetect,
      location: this.span(startTok.location, endTok.location),
    };
  }

  // =============================================================================
  // ACCEPTANCE_CRITERION
  // =============================================================================

  private parseAcceptanceCriterion(): AcceptanceCriterionDecl {
    const startTok = this.expect(TokenType.ACCEPTANCE_CRITERION);
    const name = this.expectIdentifier('acceptance criterion name');
    this.expect(TokenType.LBRACE);

    let point: string | null = null;
    let requires: PredicateExpr | null = null;
    let onFail: TriggerAction | null = null;
    const auditIncludes: string[] = [];

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.POINT:
          this.advance();
          point = this.expectIdentifier('POINT reference');
          break;
        case TokenType.REQUIRES:
          this.advance();
          requires = this.parsePredicate();
          break;
        case TokenType.ON_FAIL:
          this.advance();
          onFail = this.parseTriggerAction();
          break;
        case TokenType.AUDIT_INCLUDES:
          this.advance();
          auditIncludes.push(...this.parseIdentifierList());
          break;
        default:
          throw new ParseError(
            `Unexpected token in ACCEPTANCE_CRITERION body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (point === null)
      throw new ParseError(`ACCEPTANCE_CRITERION '${name}' is missing required field POINT`, startTok.location);
    if (requires === null)
      throw new ParseError(`ACCEPTANCE_CRITERION '${name}' is missing required field REQUIRES`, startTok.location);
    if (onFail === null)
      throw new ParseError(`ACCEPTANCE_CRITERION '${name}' is missing required field ON_FAIL`, startTok.location);

    return {
      kind: 'ACCEPTANCE_CRITERION',
      name,
      point,
      requires,
      onFail,
      auditIncludes,
      location: this.span(startTok.location, endTok.location),
    };
  }

  // =============================================================================
  // POKA_YOKE
  // =============================================================================

  private parsePokaYoke(): PokaYokeDecl {
    const startTok = this.expect(TokenType.POKA_YOKE);
    const name = this.expectIdentifier('poka-yoke name');
    this.expect(TokenType.LBRACE);

    let blocks: string | null = null;
    let when: PredicateExpr | null = null;
    let reply: string | null = null;
    let audit = false;
    let auditSeen = false;
    const auditIncludes: string[] = [];

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.BLOCKS:
          this.advance();
          blocks = this.expectIdentifier('BLOCKS reference');
          break;
        case TokenType.WHEN:
          this.advance();
          when = this.parsePredicate();
          break;
        case TokenType.REPLY:
          this.advance();
          reply = this.expectStringLiteral('REPLY value');
          break;
        case TokenType.AUDIT:
          this.advance();
          audit = this.expectBoolean('AUDIT value');
          auditSeen = true;
          break;
        case TokenType.AUDIT_INCLUDES:
          this.advance();
          auditIncludes.push(...this.parseIdentifierList());
          break;
        default:
          throw new ParseError(
            `Unexpected token in POKA_YOKE body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (blocks === null)
      throw new ParseError(`POKA_YOKE '${name}' is missing required field BLOCKS`, startTok.location);
    if (when === null)
      throw new ParseError(`POKA_YOKE '${name}' is missing required field WHEN`, startTok.location);
    if (reply === null)
      throw new ParseError(`POKA_YOKE '${name}' is missing required field REPLY`, startTok.location);
    if (!auditSeen)
      throw new ParseError(`POKA_YOKE '${name}' is missing required field AUDIT`, startTok.location);

    return {
      kind: 'POKA_YOKE',
      name,
      blocks,
      when,
      reply,
      audit,
      auditIncludes,
      location: this.span(startTok.location, endTok.location),
    };
  }

  // =============================================================================
  // ANDON
  // =============================================================================

  private parseAndon(): AndonDecl {
    const startTok = this.expect(TokenType.ANDON);
    const name = this.expectIdentifier('andon name');
    this.expect(TokenType.LBRACE);

    let halt: string | null = null;
    let preserve: string | null = null;
    let escalate: string | null = null;
    let recovery: RecoveryAction | null = null;
    let audit: AuditLevel | null = null;
    let demoVisible = false;
    let colorTag: ColorTag | undefined = undefined;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.HALT:
          this.advance();
          halt = this.expectIdentifier('HALT target');
          break;
        case TokenType.PRESERVE:
          this.advance();
          preserve = this.expectIdentifier('PRESERVE target');
          break;
        case TokenType.ESCALATE:
          this.advance();
          escalate = this.expectIdentifier('ESCALATE target');
          break;
        case TokenType.RECOVERY:
          this.advance();
          recovery = this.parseRecoveryAction();
          break;
        case TokenType.AUDIT:
          this.advance();
          audit = this.parseAuditLevel();
          break;
        case TokenType.DEMO_VISIBLE:
          this.advance();
          demoVisible = this.expectBoolean('DEMO_VISIBLE value');
          break;
        case TokenType.COLOR_TAG:
          this.advance();
          colorTag = this.parseColorTag();
          break;
        default:
          throw new ParseError(
            `Unexpected token in ANDON body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (halt === null)
      throw new ParseError(`ANDON '${name}' is missing required field HALT`, startTok.location);
    if (preserve === null)
      throw new ParseError(`ANDON '${name}' is missing required field PRESERVE`, startTok.location);
    if (escalate === null)
      throw new ParseError(`ANDON '${name}' is missing required field ESCALATE`, startTok.location);
    if (recovery === null)
      throw new ParseError(`ANDON '${name}' is missing required field RECOVERY`, startTok.location);
    if (audit === null)
      throw new ParseError(`ANDON '${name}' is missing required field AUDIT`, startTok.location);

    return {
      kind: 'ANDON',
      name,
      halt,
      preserve,
      escalate,
      recovery,
      audit,
      demoVisible,
      colorTag,
      location: this.span(startTok.location, endTok.location),
    };
  }

  private parseRecoveryAction(): RecoveryAction {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.GRACEFUL_FALLBACK: {
        this.advance();
        const message = this.expectStringLiteral('graceful_fallback message');
        return { kind: 'graceful_fallback', message };
      }
      case TokenType.RETRY_WITH_VALID_TOOL: {
        this.advance();
        this.expect(TokenType.IF);
        const condition = this.parsePredicate();
        this.expect(TokenType.ELSE);
        const elseAction = this.parseRecoveryAction();
        return { kind: 'retry_with_valid_tool', ifCondition: condition, elseAction };
      }
      case TokenType.ROUTE_TO_DEFAULT_HUMAN_QUEUE:
        this.advance();
        return { kind: 'route_to_default_human_queue' };
      case TokenType.MANUAL:
        this.advance();
        return { kind: 'manual' };
      case TokenType.IDENTIFIER: {
        const ident = this.advance();
        return { kind: 'custom', name: ident.value };
      }
      default:
        throw new ParseError(
          `Expected a RECOVERY action (graceful_fallback, retry_with_valid_tool, route_to_default_human_queue, manual, or custom identifier), got '${tok.value}'`,
          tok.location
        );
    }
  }

  // =============================================================================
  // AI_HARNESS
  // =============================================================================

  private parseAiHarness(): AiHarnessDecl {
    const startTok = this.expect(TokenType.AI_HARNESS);
    const name = this.expectIdentifier('AI harness name');
    this.expect(TokenType.LBRACE);

    let description: string | null = null;
    let permittedObservations: PermittedObservation[] | null = null;
    let permittedProposals: PermittedProposal[] | null = null;
    let forbiddenActions: string[] | null = null;
    let proposalReviewQueue: string | null = null;
    let runtimeSandbox: SandboxMode | null = null;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.DESCRIPTION:
          this.advance();
          description = this.expectStringLiteral('DESCRIPTION value');
          break;
        case TokenType.PERMITTED_OBSERVATIONS:
          this.advance();
          permittedObservations = this.parsePermittedObservations();
          break;
        case TokenType.PERMITTED_PROPOSALS:
          this.advance();
          permittedProposals = this.parsePermittedProposals();
          break;
        case TokenType.FORBIDDEN_ACTIONS:
          this.advance();
          forbiddenActions = this.parseForbiddenActions();
          break;
        case TokenType.PROPOSAL_REVIEW_QUEUE:
          this.advance();
          proposalReviewQueue = this.expectIdentifier('PROPOSAL_REVIEW_QUEUE target');
          break;
        case TokenType.RUNTIME_SANDBOX:
          this.advance();
          runtimeSandbox = this.parseSandboxMode();
          break;
        default:
          throw new ParseError(
            `Unexpected token in AI_HARNESS body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (description === null)
      throw new ParseError(`AI_HARNESS '${name}' is missing required field DESCRIPTION`, startTok.location);
    if (permittedObservations === null)
      throw new ParseError(`AI_HARNESS '${name}' is missing required field PERMITTED_OBSERVATIONS`, startTok.location);
    if (permittedProposals === null)
      throw new ParseError(`AI_HARNESS '${name}' is missing required field PERMITTED_PROPOSALS`, startTok.location);
    if (forbiddenActions === null)
      throw new ParseError(`AI_HARNESS '${name}' is missing required field FORBIDDEN_ACTIONS`, startTok.location);
    if (proposalReviewQueue === null)
      throw new ParseError(`AI_HARNESS '${name}' is missing required field PROPOSAL_REVIEW_QUEUE`, startTok.location);
    if (runtimeSandbox === null)
      throw new ParseError(`AI_HARNESS '${name}' is missing required field RUNTIME_SANDBOX`, startTok.location);

    // Merge in the standard forbidden actions (the runtime enforces them
    // regardless; the grammar promises this implicit set is always present)
    const merged = new Set<string>([...forbiddenActions, ...STANDARD_FORBIDDEN_ACTIONS]);

    return {
      kind: 'AI_HARNESS',
      name,
      description,
      permittedObservations,
      permittedProposals,
      forbiddenActions: Array.from(merged),
      proposalReviewQueue,
      runtimeSandbox,
      location: this.span(startTok.location, endTok.location),
    };
  }

  private parsePermittedObservations(): PermittedObservation[] {
    this.expect(TokenType.LBRACE);
    const result: PermittedObservation[] = [];
    while (!this.check(TokenType.RBRACE)) {
      const inspectionPoint = this.expectIdentifier('inspection point name');
      const accessLevel = this.parseAccessLevel();
      result.push({ inspectionPoint, accessLevel });
    }
    this.expect(TokenType.RBRACE);
    return result;
  }

  private parsePermittedProposals(): PermittedProposal[] {
    this.expect(TokenType.LBRACE);
    const result: PermittedProposal[] = [];
    while (!this.check(TokenType.RBRACE)) {
      const proposalType = this.expectIdentifier('proposal type');
      this.expect(TokenType.REQUIRES);
      const reviewTarget = this.expectIdentifier('REQUIRES review target');
      result.push({ proposalType, reviewTarget });
    }
    this.expect(TokenType.RBRACE);
    return result;
  }

  private parseForbiddenActions(): string[] {
    this.expect(TokenType.LBRACE);
    const result: string[] = [];
    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      if (tok.type !== TokenType.IDENTIFIER) {
        throw new ParseError(
          `Expected forbidden action identifier, got '${tok.value}' (${tok.type})`,
          tok.location
        );
      }
      result.push(tok.value);
      this.advance();
    }
    this.expect(TokenType.RBRACE);
    return result;
  }

  private parseAccessLevel(): AccessLevel {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.READ_ONLY:
        return 'READ_ONLY';
      case TokenType.READ_AGGREGATE:
        return 'READ_AGGREGATE';
      default:
        throw new ParseError(
          `Expected an access level (READ_ONLY or READ_AGGREGATE), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseSandboxMode(): SandboxMode {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.DETERMINISTIC:
        return 'deterministic';
      case TokenType.HERMETIC:
        return 'hermetic';
      case TokenType.SANDBOXED:
        return 'sandboxed';
      default:
        throw new ParseError(
          `Expected a sandbox mode (deterministic, hermetic, or sandboxed), got '${tok.value}'`,
          tok.location
        );
    }
  }

  // =============================================================================
  // AUDIT_TRAIL
  // =============================================================================

  private parseAuditTrail(): AuditTrailDecl {
    const startTok = this.expect(TokenType.AUDIT_TRAIL);
    const name = this.expectIdentifier('audit trail name');
    this.expect(TokenType.LBRACE);

    let captures: CaptureClass[] | null = null;
    let storage: StorageMode | null = null;
    let retention: Duration | null = null;
    let exportFormats: ExportFormat[] | null = null;
    let streamingTo: string | undefined = undefined;
    let timestampPrecision: TimestampPrecision | null = null;
    let provenanceChain: ProvenanceChainMode | null = null;
    let tamperEvident: TamperEvidentMode | null = null;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.CAPTURES:
          this.advance();
          captures = this.parseCaptureClassSet();
          break;
        case TokenType.STORAGE:
          this.advance();
          storage = this.parseStorageMode();
          break;
        case TokenType.RETENTION:
          this.advance();
          retention = this.parseDuration();
          break;
        case TokenType.EXPORT_FORMATS:
          this.advance();
          exportFormats = this.parseExportFormatSet();
          break;
        case TokenType.STREAMING_TO:
          this.advance();
          streamingTo = this.expectIdentifier('STREAMING_TO target');
          break;
        case TokenType.TIMESTAMP_PRECISION:
          this.advance();
          timestampPrecision = this.parseTimestampPrecision();
          break;
        case TokenType.PROVENANCE_CHAIN:
          this.advance();
          provenanceChain = this.parseProvenanceChain();
          break;
        case TokenType.TAMPER_EVIDENT:
          this.advance();
          tamperEvident = this.parseTamperEvident();
          break;
        default:
          throw new ParseError(
            `Unexpected token in AUDIT_TRAIL body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (captures === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field CAPTURES`, startTok.location);
    if (storage === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field STORAGE`, startTok.location);
    if (retention === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field RETENTION`, startTok.location);
    if (exportFormats === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field EXPORT_FORMATS`, startTok.location);
    if (timestampPrecision === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field TIMESTAMP_PRECISION`, startTok.location);
    if (provenanceChain === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field PROVENANCE_CHAIN`, startTok.location);
    if (tamperEvident === null)
      throw new ParseError(`AUDIT_TRAIL '${name}' is missing required field TAMPER_EVIDENT`, startTok.location);

    return {
      kind: 'AUDIT_TRAIL',
      name,
      captures,
      storage,
      retention,
      exportFormats,
      streamingTo,
      timestampPrecision,
      provenanceChain,
      tamperEvident,
      location: this.span(startTok.location, endTok.location),
    };
  }

  private parseCaptureClassSet(): CaptureClass[] {
    this.expect(TokenType.LBRACE);
    const result: CaptureClass[] = [];
    const allowed: Record<string, CaptureClass> = {
      [TokenType.INSPECTION_EVENTS]: 'inspection_events',
      [TokenType.CONTROL_LIMIT_EVALUATIONS]: 'control_limit_evaluations',
      [TokenType.DEFECT_MODE_EVALUATIONS]: 'defect_mode_evaluations',
      [TokenType.ACCEPTANCE_CRITERION_EVALUATIONS]: 'acceptance_criterion_evaluations',
      [TokenType.POKA_YOKE_EVALUATIONS]: 'poka_yoke_evaluations',
      [TokenType.SPC_CHART_STATE]: 'spc_chart_state',
      [TokenType.ANDON_FIRINGS]: 'andon_firings',
      [TokenType.AI_OBSERVATIONS]: 'ai_observations',
      [TokenType.AI_PROPOSALS]: 'ai_proposals',
      [TokenType.OPERATOR_ACTIONS]: 'operator_actions',
      [TokenType.RECOVERY_EXECUTIONS]: 'recovery_executions',
    };
    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      const mapped = allowed[tok.type];
      if (!mapped) {
        throw new ParseError(
          `Expected an audit-trail capture class, got '${tok.value}' (${tok.type})`,
          tok.location
        );
      }
      result.push(mapped);
      this.advance();
      if (this.check(TokenType.COMMA)) this.advance();
    }
    this.expect(TokenType.RBRACE);
    return result;
  }

  private parseExportFormatSet(): ExportFormat[] {
    this.expect(TokenType.LBRACE);
    const result: ExportFormat[] = [];
    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.CSV:
          result.push('csv');
          break;
        case TokenType.JSON:
          result.push('json');
          break;
        case TokenType.PARQUET:
          result.push('parquet');
          break;
        case TokenType.SIGNED_PDF:
          result.push('signed_pdf');
          break;
        default:
          throw new ParseError(
            `Expected an export format (csv, json, parquet, or signed_pdf), got '${tok.value}'`,
            tok.location
          );
      }
      this.advance();
      if (this.check(TokenType.COMMA)) this.advance();
    }
    this.expect(TokenType.RBRACE);
    return result;
  }

  private parseStorageMode(): StorageMode {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.APPEND_ONLY:
        return 'append_only';
      case TokenType.REPLICATED:
        return 'replicated';
      case TokenType.DISTRIBUTED:
        return 'distributed';
      default:
        throw new ParseError(
          `Expected a storage mode (append_only, replicated, or distributed), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseTimestampPrecision(): TimestampPrecision {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.MILLISECOND:
        return 'millisecond';
      case TokenType.MICROSECOND:
        return 'microsecond';
      case TokenType.NANOSECOND:
        return 'nanosecond';
      default:
        throw new ParseError(
          `Expected a timestamp precision (millisecond, microsecond, or nanosecond), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseProvenanceChain(): ProvenanceChainMode {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.NONE:
        return 'none';
      case TokenType.PARENT_LINK:
        return 'parent_link';
      case TokenType.FULL:
        return 'full';
      default:
        throw new ParseError(
          `Expected a provenance chain mode (none, parent_link, or full), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseTamperEvident(): TamperEvidentMode {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.NONE:
        return 'none';
      case TokenType.HASH_ANCHORED:
        return 'hash_anchored';
      case TokenType.BLOCKCHAIN_ANCHORED:
        return 'blockchain_anchored';
      default:
        throw new ParseError(
          `Expected a tamper-evident mode (none, hash_anchored, or blockchain_anchored), got '${tok.value}'`,
          tok.location
        );
    }
  }

  // =============================================================================
  // PRODUCTION_SYSTEM
  // =============================================================================

  private parseProductionSystem(): ProductionSystemDecl {
    const startTok = this.expect(TokenType.PRODUCTION_SYSTEM);
    const name = this.expectIdentifier('production system name');
    this.expect(TokenType.LBRACE);

    let systemKind: SystemKind | null = null;
    let source: string | null = null;
    let eventBridge: EventBridgeKind | null = null;
    let mock = false;

    while (!this.check(TokenType.RBRACE)) {
      const tok = this.peek();
      switch (tok.type) {
        case TokenType.KIND:
          this.advance();
          systemKind = this.parseSystemKind();
          break;
        case TokenType.SOURCE:
          this.advance();
          source = this.expectStringLiteral('SOURCE path');
          break;
        case TokenType.EVENT_BRIDGE:
          this.advance();
          eventBridge = this.parseEventBridge();
          break;
        case TokenType.MOCK:
          this.advance();
          mock = this.expectBoolean('MOCK value');
          break;
        default:
          throw new ParseError(
            `Unexpected token in PRODUCTION_SYSTEM body: '${tok.value}' (${tok.type})`,
            tok.location
          );
      }
    }

    const endTok = this.expect(TokenType.RBRACE);

    if (systemKind === null)
      throw new ParseError(`PRODUCTION_SYSTEM '${name}' is missing required field KIND`, startTok.location);
    if (source === null)
      throw new ParseError(`PRODUCTION_SYSTEM '${name}' is missing required field SOURCE`, startTok.location);
    if (eventBridge === null)
      throw new ParseError(`PRODUCTION_SYSTEM '${name}' is missing required field EVENT_BRIDGE`, startTok.location);

    return {
      kind: 'PRODUCTION_SYSTEM',
      name,
      systemKind,
      source,
      eventBridge,
      mock,
      location: this.span(startTok.location, endTok.location),
    };
  }

  private parseSystemKind(): SystemKind {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.AGICORE_APP:
        return 'agicore_app';
      case TokenType.HTTP_SERVICE:
        return 'http_service';
      case TokenType.RUST_BINARY:
        return 'rust_binary';
      case TokenType.PYTHON_SERVICE:
        return 'python_service';
      case TokenType.MOCK:
        return 'mock';
      default:
        throw new ParseError(
          `Expected a system kind (agicore_app, http_service, rust_binary, python_service, or mock), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseEventBridge(): EventBridgeKind {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.IN_PROCESS_PUBSUB:
        return 'in_process_pubsub';
      case TokenType.NATS:
        return 'nats';
      case TokenType.KAFKA:
        return 'kafka';
      case TokenType.REDIS_STREAMS:
        return 'redis_streams';
      default:
        throw new ParseError(
          `Expected an event-bridge kind (in_process_pubsub, nats, kafka, or redis_streams), got '${tok.value}'`,
          tok.location
        );
    }
  }

  // =============================================================================
  // PREDICATE LANGUAGE
  //
  // The mini-DSL used by WHEN, DETECTS, REQUIRES, and POKA_YOKE WHEN.
  // Operator precedence (low to high):
  //   1. OR
  //   2. AND
  //   3. NOT (prefix unary)
  //   4. atom + optional postfix predicate tail (comparison, membership,
  //      null check, contains, matches)
  // Atoms are field paths, identifiers, or literals.
  // Parenthesized predicates can appear in place of a primary expression.
  // =============================================================================

  private parsePredicate(): PredicateExpr {
    return this.parseOrExpr();
  }

  private parseOrExpr(): PredicateExpr {
    let left = this.parseAndExpr();
    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseAndExpr();
      // Flatten chained ORs into a single combinator
      if (left.kind === 'boolean' && left.op === 'OR') {
        left.operands.push(right);
      } else {
        left = { kind: 'boolean', op: 'OR', operands: [left, right] };
      }
    }
    return left;
  }

  private parseAndExpr(): PredicateExpr {
    let left = this.parseUnaryExpr();
    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseUnaryExpr();
      if (left.kind === 'boolean' && left.op === 'AND') {
        left.operands.push(right);
      } else {
        left = { kind: 'boolean', op: 'AND', operands: [left, right] };
      }
    }
    return left;
  }

  private parseUnaryExpr(): PredicateExpr {
    if (this.check(TokenType.NOT)) {
      this.advance();
      const inner = this.parseUnaryExpr();
      return { kind: 'boolean', op: 'NOT', operands: [inner] };
    }
    return this.parsePrimaryExpr();
  }

  private parsePrimaryExpr(): PredicateExpr {
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const inner = this.parsePredicate();
      this.expect(TokenType.RPAREN);
      return { kind: 'parenthesized', inner };
    }
    return this.parseComparableExpr();
  }

  private parseComparableExpr(): PredicateExpr {
    const left = this.parseAtom();

    // Look for a postfix predicate tail.
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.EQ:
      case TokenType.NEQ:
      case TokenType.LT:
      case TokenType.LTE:
      case TokenType.GT:
      case TokenType.GTE: {
        const opMap: Record<string, '==' | '!=' | '<' | '<=' | '>' | '>='> = {
          [TokenType.EQ]: '==',
          [TokenType.NEQ]: '!=',
          [TokenType.LT]: '<',
          [TokenType.LTE]: '<=',
          [TokenType.GT]: '>',
          [TokenType.GTE]: '>=',
        };
        const op = opMap[tok.type]!;
        this.advance();
        const right = this.parseAtom();
        return { kind: 'comparison', op, left, right };
      }
      case TokenType.IN: {
        this.advance();
        const setRef = this.parseIdentifierRef('IN set reference');
        return { kind: 'membership', negate: false, value: left, set: setRef };
      }
      case TokenType.NOT: {
        // Look at what follows the NOT
        const next = this.peekAt(1);
        if (next.type === TokenType.IN) {
          this.advance(); // NOT
          this.advance(); // IN
          const setRef = this.parseIdentifierRef('NOT IN set reference');
          return { kind: 'membership', negate: true, value: left, set: setRef };
        }
        // Otherwise NOT is the start of a unary expression at the next level;
        // don't consume it here.
        return left;
      }
      case TokenType.IS_NULL:
        this.advance();
        return { kind: 'null_check', expr: left, isNull: true };
      case TokenType.IS_NOT_NULL:
        this.advance();
        return { kind: 'null_check', expr: left, isNull: false };
      case TokenType.CONTAINS_PREDICATE: {
        const containsTok = this.advance();
        let notMatching: IdentifierRef | undefined = undefined;
        if (this.check(TokenType.NOT) && this.peekAt(1).type === TokenType.MATCHING) {
          this.advance(); // NOT
          this.advance(); // MATCHING
          notMatching = this.parseIdentifierRef('NOT MATCHING reference');
        }
        return {
          kind: 'contains',
          predicateName: containsTok.value,
          notMatching,
          subject: left,
        };
      }
      case TokenType.MATCHES: {
        this.advance();
        const patternTok = this.peek();
        if (patternTok.type === TokenType.IDENTIFIER) {
          const pattern = this.parseIdentifierRef('MATCHES pattern');
          return { kind: 'matches', subject: left, pattern };
        }
        if (patternTok.type === TokenType.STRING_LITERAL) {
          const literal: LiteralValue = {
            kind: 'literal',
            value: patternTok.value,
            type: 'string',
          };
          this.advance();
          return { kind: 'matches', subject: left, pattern: literal };
        }
        throw new ParseError(
          `Expected MATCHES pattern (identifier or string literal), got '${patternTok.value}'`,
          patternTok.location
        );
      }
      default:
        return left;
    }
  }

  private parseAtom(): PredicateExpr {
    const tok = this.peek();

    if (tok.type === TokenType.STRING_LITERAL) {
      this.advance();
      return { kind: 'literal', value: tok.value, type: 'string' };
    }

    if (tok.type === TokenType.NUMBER_LITERAL) {
      this.advance();
      const num = Number(tok.value);
      const isFloat = tok.value.includes('.');
      return { kind: 'literal', value: num, type: isFloat ? 'float' : 'number' };
    }

    if (tok.type === TokenType.TRUE) {
      this.advance();
      return { kind: 'literal', value: true, type: 'bool' };
    }
    if (tok.type === TokenType.FALSE) {
      this.advance();
      return { kind: 'literal', value: false, type: 'bool' };
    }

    if (tok.type === TokenType.IDENTIFIER) {
      return this.parseFieldPathOrIdentifier();
    }

    throw new ParseError(
      `Expected an atom (identifier, field path, or literal), got '${tok.value}' (${tok.type})`,
      tok.location
    );
  }

  private parseFieldPathOrIdentifier(): FieldPath | IdentifierRef {
    const first = this.expectIdentifier('field name or identifier');
    if (!this.check(TokenType.DOT)) {
      return { kind: 'identifier', name: first };
    }
    const segments = [first];
    while (this.check(TokenType.DOT)) {
      this.advance();
      segments.push(this.expectIdentifier('field path segment'));
    }
    return { kind: 'field_path', segments };
  }

  private parseFieldPath(): FieldPath {
    const node = this.parseFieldPathOrIdentifier();
    if (node.kind === 'identifier') {
      return { kind: 'field_path', segments: [node.name] };
    }
    return node;
  }

  private parseIdentifierRef(context: string): IdentifierRef {
    const tok = this.peek();
    if (tok.type !== TokenType.IDENTIFIER) {
      throw new ParseError(
        `Expected ${context}, got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    this.advance();
    return { kind: 'identifier', name: tok.value };
  }

  // =============================================================================
  // Helper parsers for common patterns
  // =============================================================================

  private parseTriggerAction(): TriggerAction {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.ANDON: {
        this.advance();
        const andonName = this.expectIdentifier('ANDON name');
        const ref: AndonRef = { kind: 'andon_ref', andonName };
        return ref;
      }
      case TokenType.PROPOSE_REVIEW: {
        this.advance();
        const target = this.parseIdentifierRef('PROPOSE_REVIEW target');
        const ref: ProposeReviewRef = { kind: 'propose_review', target };
        return ref;
      }
      default:
        throw new ParseError(
          `Expected a trigger action (ANDON <name> or PROPOSE_REVIEW <target>), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseSeverity(): SeverityLevel {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.CRITICAL:
        return 'critical';
      case TokenType.HIGH:
        return 'high';
      case TokenType.MEDIUM:
        return 'medium';
      case TokenType.LOW:
        return 'low';
      case TokenType.INFO:
        return 'info';
      default:
        throw new ParseError(
          `Expected a severity level (critical, high, medium, low, or info), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseChartType(): ChartType {
    const tok = this.advance();
    // xbar is a multi-letter reserved keyword
    if (tok.type === TokenType.XBAR) return 'xbar';
    // Single-letter chart types are tokenized as identifiers; check the value
    if (tok.type === TokenType.IDENTIFIER) {
      const valid: ChartType[] = ['r', 's', 'p', 'c', 'u', 'i', 'mr'];
      if ((valid as readonly string[]).includes(tok.value)) {
        return tok.value as ChartType;
      }
    }
    throw new ParseError(
      `Expected a chart type (xbar, r, s, p, c, u, i, or mr), got '${tok.value}'`,
      tok.location
    );
  }

  private parseWesternElectric(): WesternElectricRuleSet {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.RULES_1_2:
        return 'rules_1_2';
      case TokenType.RULES_1_2_5_6:
        return 'rules_1_2_5_6';
      case TokenType.ALL:
        return 'all';
      case TokenType.NONE:
        return 'none';
      default:
        throw new ParseError(
          `Expected a Western Electric rule set (rules_1_2, rules_1_2_5_6, all, or none), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseAuditLevel(): AuditLevel {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.VERBOSE:
        return 'verbose';
      case TokenType.STANDARD:
        return 'standard';
      case TokenType.MINIMAL:
        return 'minimal';
      default:
        throw new ParseError(
          `Expected an audit level (verbose, standard, or minimal), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseColorTag(): ColorTag {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.RED:
        return 'red';
      case TokenType.ORANGE:
        return 'orange';
      case TokenType.YELLOW:
        return 'yellow';
      case TokenType.BLUE:
        return 'blue';
      case TokenType.GREEN:
        return 'green';
      case TokenType.GRAY:
        return 'gray';
      default:
        throw new ParseError(
          `Expected a color tag (red, orange, yellow, blue, green, or gray), got '${tok.value}'`,
          tok.location
        );
    }
  }

  private parseIdentifierList(): string[] {
    const result: string[] = [];
    do {
      result.push(this.expectIdentifier('identifier in list'));
      if (this.check(TokenType.COMMA)) {
        this.advance();
      } else {
        break;
      }
    } while (true);
    return result;
  }

  private parseDuration(): Duration {
    const tok = this.peek();
    if (tok.type !== TokenType.DURATION_LITERAL) {
      throw new ParseError(
        `Expected a duration literal (e.g., 7_years, 30_seconds), got '${tok.value}'`,
        tok.location
      );
    }
    this.advance();
    const parts = tok.value.split('_');
    const unit = parts[parts.length - 1] as Duration['unit'];
    const valueStr = parts.slice(0, -1).join('_');
    return { value: Number(valueStr), unit };
  }

  // =============================================================================
  // File assembly
  // =============================================================================

  private assembleFile(decls: QcDeclaration[]): QcFile {
    let controlPlan: ControlPlanDecl | null = null;
    let aiHarness: AiHarnessDecl | null = null;
    let auditTrail: AuditTrailDecl | null = null;
    let productionSystem: ProductionSystemDecl | null = null;
    const inspectionPoints: InspectionPointDecl[] = [];
    const controlLimits: ControlLimitDecl[] = [];
    const spcCharts: SpcChartDecl[] = [];
    const defectModes: DefectModeDecl[] = [];
    const acceptanceCriteria: AcceptanceCriterionDecl[] = [];
    const pokaYokes: PokaYokeDecl[] = [];
    const andons: AndonDecl[] = [];

    for (const decl of decls) {
      switch (decl.kind) {
        case 'CONTROL_PLAN':
          if (controlPlan !== null) {
            throw new ParseError(
              `Multiple CONTROL_PLAN declarations found (only one is allowed)`,
              decl.location.start
            );
          }
          controlPlan = decl;
          break;
        case 'INSPECTION_POINT':
          inspectionPoints.push(decl);
          break;
        case 'CONTROL_LIMIT':
          controlLimits.push(decl);
          break;
        case 'SPC_CHART':
          spcCharts.push(decl);
          break;
        case 'DEFECT_MODE':
          defectModes.push(decl);
          break;
        case 'ACCEPTANCE_CRITERION':
          acceptanceCriteria.push(decl);
          break;
        case 'POKA_YOKE':
          pokaYokes.push(decl);
          break;
        case 'ANDON':
          andons.push(decl);
          break;
        case 'AI_HARNESS':
          if (aiHarness !== null) {
            throw new ParseError(
              `Multiple AI_HARNESS declarations found (exactly one required)`,
              decl.location.start
            );
          }
          aiHarness = decl;
          break;
        case 'AUDIT_TRAIL':
          if (auditTrail !== null) {
            throw new ParseError(
              `Multiple AUDIT_TRAIL declarations found (exactly one required)`,
              decl.location.start
            );
          }
          auditTrail = decl;
          break;
        case 'PRODUCTION_SYSTEM':
          if (productionSystem !== null) {
            throw new ParseError(
              `Multiple PRODUCTION_SYSTEM declarations found (exactly one required)`,
              decl.location.start
            );
          }
          productionSystem = decl;
          break;
      }
    }

    if (controlPlan === null) {
      throw new ParseError(
        `Missing required CONTROL_PLAN declaration`,
        { line: 1, column: 1 }
      );
    }
    if (inspectionPoints.length === 0) {
      throw new ParseError(
        `At least one INSPECTION_POINT declaration is required`,
        controlPlan.location.start
      );
    }
    if (aiHarness === null) {
      throw new ParseError(
        `Missing required AI_HARNESS declaration`,
        controlPlan.location.start
      );
    }
    if (auditTrail === null) {
      throw new ParseError(
        `Missing required AUDIT_TRAIL declaration`,
        controlPlan.location.start
      );
    }
    if (productionSystem === null) {
      throw new ParseError(
        `Missing required PRODUCTION_SYSTEM declaration`,
        controlPlan.location.start
      );
    }

    return {
      controlPlan,
      inspectionPoints,
      controlLimits,
      spcCharts,
      defectModes,
      acceptanceCriteria,
      pokaYokes,
      andons,
      aiHarness,
      auditTrail,
      productionSystem,
    };
  }

  // =============================================================================
  // Token helpers
  // =============================================================================

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private peekAt(offset: number): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]!; // EOF
    }
    return this.tokens[idx]!;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1]!;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos]!;
    if (tok.type !== TokenType.EOF) {
      this.pos++;
    }
    return tok;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private expect(type: TokenType): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new ParseError(
        `Expected ${type}, got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    return this.advance();
  }

  private expectIdentifier(context: string): string {
    const tok = this.peek();
    if (tok.type !== TokenType.IDENTIFIER) {
      throw new ParseError(
        `Expected ${context} (identifier), got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    this.advance();
    return tok.value;
  }

  private expectStringLiteral(context: string): string {
    const tok = this.peek();
    if (tok.type !== TokenType.STRING_LITERAL) {
      throw new ParseError(
        `Expected ${context} (string literal), got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    this.advance();
    return tok.value;
  }

  private expectNumber(context: string): number {
    const tok = this.peek();
    if (tok.type !== TokenType.NUMBER_LITERAL) {
      throw new ParseError(
        `Expected ${context} (number literal), got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    this.advance();
    return Number(tok.value);
  }

  private expectInteger(context: string): number {
    const tok = this.peek();
    if (tok.type !== TokenType.NUMBER_LITERAL) {
      throw new ParseError(
        `Expected ${context} (integer literal), got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    if (tok.value.includes('.')) {
      throw new ParseError(
        `Expected ${context} (integer), got float literal '${tok.value}'`,
        tok.location
      );
    }
    this.advance();
    return Number(tok.value);
  }

  private expectBoolean(context: string): boolean {
    const tok = this.peek();
    if (tok.type !== TokenType.TRUE && tok.type !== TokenType.FALSE) {
      throw new ParseError(
        `Expected ${context} (true or false), got '${tok.value}' (${tok.type})`,
        tok.location
      );
    }
    this.advance();
    return tok.type === TokenType.TRUE;
  }

  private expectDottedIdentifier(context: string): string {
    const parts: string[] = [];
    parts.push(this.expectIdentifier(`${context} (first segment)`));
    while (this.check(TokenType.DOT)) {
      this.advance();
      parts.push(this.expectIdentifier(`${context} (segment after dot)`));
    }
    return parts.join('.');
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private span(start: SourceLocation, end: SourceLocation): SourceSpan {
    return { start, end };
  }
}
