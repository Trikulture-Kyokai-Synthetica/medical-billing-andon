// Agicore QC Dialect Lexer — Tokenizes .qc source text
//
// See agicore/dsl/qc-grammar.md for the lexical structure specification.

import type { SourceLocation } from './types.js';

// --- Token Types ---

export enum TokenType {
  // === Top-level declaration keywords ===
  CONTROL_PLAN = 'CONTROL_PLAN',
  INSPECTION_POINT = 'INSPECTION_POINT',
  CONTROL_LIMIT = 'CONTROL_LIMIT',
  SPC_CHART = 'SPC_CHART',
  DEFECT_MODE = 'DEFECT_MODE',
  ACCEPTANCE_CRITERION = 'ACCEPTANCE_CRITERION',
  POKA_YOKE = 'POKA_YOKE',
  ANDON = 'ANDON',
  AI_HARNESS = 'AI_HARNESS',
  AUDIT_TRAIL = 'AUDIT_TRAIL',
  PRODUCTION_SYSTEM = 'PRODUCTION_SYSTEM',

  // === CONTROL_PLAN field keywords ===
  TITLE = 'TITLE',
  VERSION = 'VERSION',
  DESCRIPTION = 'DESCRIPTION',
  AUTHORITY = 'AUTHORITY',
  // (PRODUCTION_SYSTEM doubles as a declaration and as a reference inside CONTROL_PLAN)

  // CONTROL_PLAN enumeration block keywords
  INSPECTION_POINTS = 'INSPECTION_POINTS',
  CONTROL_LIMITS = 'CONTROL_LIMITS',
  SPC_CHARTS = 'SPC_CHARTS',
  DEFECT_MODES = 'DEFECT_MODES',
  ACCEPTANCE_CRITERIA = 'ACCEPTANCE_CRITERIA',
  POKA_YOKES = 'POKA_YOKES',
  ANDONS = 'ANDONS',

  // === INSPECTION_POINT field keywords ===
  CAPTURES = 'CAPTURES',
  SCOPE = 'SCOPE',
  STREAMS_TO = 'STREAMS_TO',

  // Scope values
  CUSTOMER_FACING = 'CUSTOMER_FACING', // tokenized as the identifier customer-facing? handled specially
  INTERNAL = 'INTERNAL',
  PRE_EMISSION = 'PRE_EMISSION',
  POST_EMISSION = 'POST_EMISSION',

  // === CONTROL_LIMIT / SPC_CHART field keywords ===
  POINT = 'POINT',
  WHEN = 'WHEN',
  MEASURE = 'MEASURE',
  UPPER = 'UPPER',
  LOWER = 'LOWER',
  ON_VIOLATION = 'ON_VIOLATION',
  AUDIT_VERBOSE = 'AUDIT_VERBOSE',
  CHART_TYPE = 'CHART_TYPE',
  SAMPLE_SIZE = 'SAMPLE_SIZE',
  WESTERN_ELECTRIC = 'WESTERN_ELECTRIC',
  ON_RULE_VIOLATION = 'ON_RULE_VIOLATION',

  // === DEFECT_MODE / ACCEPTANCE_CRITERION / POKA_YOKE field keywords ===
  DETECTS = 'DETECTS',
  SEVERITY = 'SEVERITY',
  ON_DETECT = 'ON_DETECT',
  REQUIRES = 'REQUIRES',
  ON_FAIL = 'ON_FAIL',
  AUDIT_INCLUDES = 'AUDIT_INCLUDES',
  BLOCKS = 'BLOCKS',
  REPLY = 'REPLY',

  // === ANDON field keywords ===
  HALT = 'HALT',
  PRESERVE = 'PRESERVE',
  ESCALATE = 'ESCALATE',
  RECOVERY = 'RECOVERY',
  AUDIT = 'AUDIT',
  DEMO_VISIBLE = 'DEMO_VISIBLE',
  COLOR_TAG = 'COLOR_TAG',

  // Recovery action keywords
  GRACEFUL_FALLBACK = 'GRACEFUL_FALLBACK',
  RETRY_WITH_VALID_TOOL = 'RETRY_WITH_VALID_TOOL',
  ROUTE_TO_DEFAULT_HUMAN_QUEUE = 'ROUTE_TO_DEFAULT_HUMAN_QUEUE',
  MANUAL = 'MANUAL',
  IF = 'IF',
  ELSE = 'ELSE',

  // === AI_HARNESS field keywords ===
  PERMITTED_OBSERVATIONS = 'PERMITTED_OBSERVATIONS',
  PERMITTED_PROPOSALS = 'PERMITTED_PROPOSALS',
  FORBIDDEN_ACTIONS = 'FORBIDDEN_ACTIONS',
  PROPOSAL_REVIEW_QUEUE = 'PROPOSAL_REVIEW_QUEUE',
  RUNTIME_SANDBOX = 'RUNTIME_SANDBOX',

  // Access level
  READ_ONLY = 'READ_ONLY',
  READ_AGGREGATE = 'READ_AGGREGATE',

  // Sandbox modes
  DETERMINISTIC = 'DETERMINISTIC',
  HERMETIC = 'HERMETIC',
  SANDBOXED = 'SANDBOXED',

  // === AUDIT_TRAIL field keywords ===
  STORAGE = 'STORAGE',
  RETENTION = 'RETENTION',
  EXPORT_FORMATS = 'EXPORT_FORMATS',
  STREAMING_TO = 'STREAMING_TO',
  TIMESTAMP_PRECISION = 'TIMESTAMP_PRECISION',
  PROVENANCE_CHAIN = 'PROVENANCE_CHAIN',
  TAMPER_EVIDENT = 'TAMPER_EVIDENT',

  // Storage modes
  APPEND_ONLY = 'APPEND_ONLY',
  REPLICATED = 'REPLICATED',
  DISTRIBUTED = 'DISTRIBUTED',

  // Export formats
  CSV = 'CSV',
  JSON = 'JSON',
  PARQUET = 'PARQUET',
  SIGNED_PDF = 'SIGNED_PDF',

  // Timestamp precision
  MILLISECOND = 'MILLISECOND',
  MICROSECOND = 'MICROSECOND',
  NANOSECOND = 'NANOSECOND',

  // Provenance chain
  PARENT_LINK = 'PARENT_LINK',
  FULL = 'FULL',

  // Tamper evident
  NONE = 'NONE',
  HASH_ANCHORED = 'HASH_ANCHORED',
  BLOCKCHAIN_ANCHORED = 'BLOCKCHAIN_ANCHORED',

  // === PRODUCTION_SYSTEM field keywords ===
  KIND = 'KIND',
  SOURCE = 'SOURCE',
  EVENT_BRIDGE = 'EVENT_BRIDGE',
  MOCK = 'MOCK',

  // System kinds
  AGICORE_APP = 'AGICORE_APP',
  HTTP_SERVICE = 'HTTP_SERVICE',
  RUST_BINARY = 'RUST_BINARY',
  PYTHON_SERVICE = 'PYTHON_SERVICE',

  // Event bridge kinds
  IN_PROCESS_PUBSUB = 'IN_PROCESS_PUBSUB',
  NATS = 'NATS',
  KAFKA = 'KAFKA',
  REDIS_STREAMS = 'REDIS_STREAMS',

  // === Severity values ===
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',

  // === Chart types ===
  XBAR = 'XBAR',
  R = 'R',
  S = 'S',
  P = 'P',
  C = 'C',
  U = 'U',
  I = 'I',
  MR = 'MR',

  // === Western Electric rule sets ===
  RULES_1_2 = 'RULES_1_2',
  RULES_1_2_5_6 = 'RULES_1_2_5_6',
  ALL = 'ALL',

  // === Color tags ===
  RED = 'RED',
  ORANGE = 'ORANGE',
  YELLOW = 'YELLOW',
  BLUE = 'BLUE',
  GREEN = 'GREEN',
  GRAY = 'GRAY',

  // === Audit levels ===
  VERBOSE = 'VERBOSE',
  STANDARD = 'STANDARD',
  MINIMAL = 'MINIMAL',

  // === Capture classes (used in AUDIT_TRAIL CAPTURES set) ===
  INSPECTION_EVENTS = 'INSPECTION_EVENTS',
  CONTROL_LIMIT_EVALUATIONS = 'CONTROL_LIMIT_EVALUATIONS',
  DEFECT_MODE_EVALUATIONS = 'DEFECT_MODE_EVALUATIONS',
  ACCEPTANCE_CRITERION_EVALUATIONS = 'ACCEPTANCE_CRITERION_EVALUATIONS',
  POKA_YOKE_EVALUATIONS = 'POKA_YOKE_EVALUATIONS',
  SPC_CHART_STATE = 'SPC_CHART_STATE',
  ANDON_FIRINGS = 'ANDON_FIRINGS',
  AI_OBSERVATIONS = 'AI_OBSERVATIONS',
  AI_PROPOSALS = 'AI_PROPOSALS',
  OPERATOR_ACTIONS = 'OPERATOR_ACTIONS',
  RECOVERY_EXECUTIONS = 'RECOVERY_EXECUTIONS',

  // === Primitive type keywords (inherited from .agi) ===
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  FLOAT = 'FLOAT',
  BOOL = 'BOOL',
  DATE = 'DATE',
  DATETIME = 'DATETIME',
  ID = 'ID',
  // JSON already a token above

  // === Predicate language keywords ===
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  IN = 'IN',
  IS_NULL = 'IS_NULL',
  IS_NOT_NULL = 'IS_NOT_NULL',
  MATCHES = 'MATCHES',
  MATCHING = 'MATCHING',
  PROPOSE_REVIEW = 'PROPOSE_REVIEW',

  // CONTAINS_* family — parsed as a single identifier-like token whose
  // text matches the pattern CONTAINS_[A-Z_]+. The parser treats this as
  // an extensible registry; the lexer surfaces it as CONTAINS_PREDICATE
  // with the specific name stashed in the token value.
  CONTAINS_PREDICATE = 'CONTAINS_PREDICATE',

  // === Boolean literals ===
  TRUE = 'TRUE',
  FALSE = 'FALSE',

  // === Punctuation and operators ===
  LBRACE = 'LBRACE', // {
  RBRACE = 'RBRACE', // }
  LBRACKET = 'LBRACKET', // [
  RBRACKET = 'RBRACKET', // ]
  LPAREN = 'LPAREN', // (
  RPAREN = 'RPAREN', // )
  COMMA = 'COMMA',
  COLON = 'COLON',
  DOT = 'DOT',
  EQ = 'EQ', // ==
  NEQ = 'NEQ', // !=
  LT = 'LT',
  LTE = 'LTE',
  GT = 'GT',
  GTE = 'GTE',
  ASSIGN = 'ASSIGN', // =  (used in default-value contexts, future)

  // === Identifiers, literals ===
  IDENTIFIER = 'IDENTIFIER',
  STRING_LITERAL = 'STRING_LITERAL',
  NUMBER_LITERAL = 'NUMBER_LITERAL',
  DURATION_LITERAL = 'DURATION_LITERAL', // e.g., 7_years, 30_seconds

  // === Special ===
  EOF = 'EOF',
}

// --- Token ---

export interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}

// --- Lexer Error ---

export class LexerError extends Error {
  constructor(
    message: string,
    public location: SourceLocation
  ) {
    super(`Lexer error at line ${location.line}, column ${location.column}: ${message}`);
    this.name = 'LexerError';
  }
}

// --- Keyword map ---

const KEYWORDS: Record<string, TokenType> = {
  // Top-level declarations
  CONTROL_PLAN: TokenType.CONTROL_PLAN,
  INSPECTION_POINT: TokenType.INSPECTION_POINT,
  CONTROL_LIMIT: TokenType.CONTROL_LIMIT,
  SPC_CHART: TokenType.SPC_CHART,
  DEFECT_MODE: TokenType.DEFECT_MODE,
  ACCEPTANCE_CRITERION: TokenType.ACCEPTANCE_CRITERION,
  POKA_YOKE: TokenType.POKA_YOKE,
  ANDON: TokenType.ANDON,
  AI_HARNESS: TokenType.AI_HARNESS,
  AUDIT_TRAIL: TokenType.AUDIT_TRAIL,
  PRODUCTION_SYSTEM: TokenType.PRODUCTION_SYSTEM,

  // CONTROL_PLAN
  TITLE: TokenType.TITLE,
  VERSION: TokenType.VERSION,
  DESCRIPTION: TokenType.DESCRIPTION,
  AUTHORITY: TokenType.AUTHORITY,
  INSPECTION_POINTS: TokenType.INSPECTION_POINTS,
  CONTROL_LIMITS: TokenType.CONTROL_LIMITS,
  SPC_CHARTS: TokenType.SPC_CHARTS,
  DEFECT_MODES: TokenType.DEFECT_MODES,
  ACCEPTANCE_CRITERIA: TokenType.ACCEPTANCE_CRITERIA,
  POKA_YOKES: TokenType.POKA_YOKES,
  ANDONS: TokenType.ANDONS,

  // INSPECTION_POINT
  CAPTURES: TokenType.CAPTURES,
  SCOPE: TokenType.SCOPE,
  STREAMS_TO: TokenType.STREAMS_TO,
  internal: TokenType.INTERNAL,
  'pre-emission': TokenType.PRE_EMISSION, // hyphenated identifier; handled specially
  'post-emission': TokenType.POST_EMISSION,
  'customer-facing': TokenType.CUSTOMER_FACING,

  // CONTROL_LIMIT / SPC_CHART
  POINT: TokenType.POINT,
  WHEN: TokenType.WHEN,
  MEASURE: TokenType.MEASURE,
  UPPER: TokenType.UPPER,
  LOWER: TokenType.LOWER,
  ON_VIOLATION: TokenType.ON_VIOLATION,
  AUDIT_VERBOSE: TokenType.AUDIT_VERBOSE,
  CHART_TYPE: TokenType.CHART_TYPE,
  SAMPLE_SIZE: TokenType.SAMPLE_SIZE,
  WESTERN_ELECTRIC: TokenType.WESTERN_ELECTRIC,
  ON_RULE_VIOLATION: TokenType.ON_RULE_VIOLATION,

  // DEFECT_MODE / ACCEPTANCE_CRITERION / POKA_YOKE
  DETECTS: TokenType.DETECTS,
  SEVERITY: TokenType.SEVERITY,
  ON_DETECT: TokenType.ON_DETECT,
  REQUIRES: TokenType.REQUIRES,
  ON_FAIL: TokenType.ON_FAIL,
  AUDIT_INCLUDES: TokenType.AUDIT_INCLUDES,
  BLOCKS: TokenType.BLOCKS,
  REPLY: TokenType.REPLY,

  // ANDON
  HALT: TokenType.HALT,
  PRESERVE: TokenType.PRESERVE,
  ESCALATE: TokenType.ESCALATE,
  RECOVERY: TokenType.RECOVERY,
  AUDIT: TokenType.AUDIT,
  DEMO_VISIBLE: TokenType.DEMO_VISIBLE,
  COLOR_TAG: TokenType.COLOR_TAG,
  graceful_fallback: TokenType.GRACEFUL_FALLBACK,
  retry_with_valid_tool: TokenType.RETRY_WITH_VALID_TOOL,
  route_to_default_human_queue: TokenType.ROUTE_TO_DEFAULT_HUMAN_QUEUE,
  manual: TokenType.MANUAL,
  IF: TokenType.IF,
  ELSE: TokenType.ELSE,

  // AI_HARNESS
  PERMITTED_OBSERVATIONS: TokenType.PERMITTED_OBSERVATIONS,
  PERMITTED_PROPOSALS: TokenType.PERMITTED_PROPOSALS,
  FORBIDDEN_ACTIONS: TokenType.FORBIDDEN_ACTIONS,
  PROPOSAL_REVIEW_QUEUE: TokenType.PROPOSAL_REVIEW_QUEUE,
  RUNTIME_SANDBOX: TokenType.RUNTIME_SANDBOX,
  READ_ONLY: TokenType.READ_ONLY,
  READ_AGGREGATE: TokenType.READ_AGGREGATE,
  deterministic: TokenType.DETERMINISTIC,
  hermetic: TokenType.HERMETIC,
  sandboxed: TokenType.SANDBOXED,

  // AUDIT_TRAIL
  STORAGE: TokenType.STORAGE,
  RETENTION: TokenType.RETENTION,
  EXPORT_FORMATS: TokenType.EXPORT_FORMATS,
  STREAMING_TO: TokenType.STREAMING_TO,
  TIMESTAMP_PRECISION: TokenType.TIMESTAMP_PRECISION,
  PROVENANCE_CHAIN: TokenType.PROVENANCE_CHAIN,
  TAMPER_EVIDENT: TokenType.TAMPER_EVIDENT,
  append_only: TokenType.APPEND_ONLY,
  replicated: TokenType.REPLICATED,
  distributed: TokenType.DISTRIBUTED,
  csv: TokenType.CSV,
  json: TokenType.JSON,
  parquet: TokenType.PARQUET,
  signed_pdf: TokenType.SIGNED_PDF,
  millisecond: TokenType.MILLISECOND,
  microsecond: TokenType.MICROSECOND,
  nanosecond: TokenType.NANOSECOND,
  parent_link: TokenType.PARENT_LINK,
  full: TokenType.FULL,
  none: TokenType.NONE,
  hash_anchored: TokenType.HASH_ANCHORED,
  blockchain_anchored: TokenType.BLOCKCHAIN_ANCHORED,

  // PRODUCTION_SYSTEM
  KIND: TokenType.KIND,
  SOURCE: TokenType.SOURCE,
  EVENT_BRIDGE: TokenType.EVENT_BRIDGE,
  MOCK: TokenType.MOCK,
  agicore_app: TokenType.AGICORE_APP,
  http_service: TokenType.HTTP_SERVICE,
  rust_binary: TokenType.RUST_BINARY,
  python_service: TokenType.PYTHON_SERVICE,
  mock: TokenType.MOCK, // value-side
  in_process_pubsub: TokenType.IN_PROCESS_PUBSUB,
  nats: TokenType.NATS,
  kafka: TokenType.KAFKA,
  redis_streams: TokenType.REDIS_STREAMS,

  // Severity
  critical: TokenType.CRITICAL,
  high: TokenType.HIGH,
  medium: TokenType.MEDIUM,
  low: TokenType.LOW,
  info: TokenType.INFO,

  // Chart types — only the multi-letter ones are reserved. Single-letter
  // chart types (r, s, p, c, u, i, mr) are parsed as identifiers; the chart
  // type parser checks the identifier's value. This avoids collisions when
  // users want common single-letter field names.
  xbar: TokenType.XBAR,

  // Western Electric
  rules_1_2: TokenType.RULES_1_2,
  rules_1_2_5_6: TokenType.RULES_1_2_5_6,
  all: TokenType.ALL,

  // Colors
  red: TokenType.RED,
  orange: TokenType.ORANGE,
  yellow: TokenType.YELLOW,
  blue: TokenType.BLUE,
  green: TokenType.GREEN,
  gray: TokenType.GRAY,

  // Audit levels
  verbose: TokenType.VERBOSE,
  standard: TokenType.STANDARD,
  minimal: TokenType.MINIMAL,

  // Capture classes
  inspection_events: TokenType.INSPECTION_EVENTS,
  control_limit_evaluations: TokenType.CONTROL_LIMIT_EVALUATIONS,
  defect_mode_evaluations: TokenType.DEFECT_MODE_EVALUATIONS,
  acceptance_criterion_evaluations: TokenType.ACCEPTANCE_CRITERION_EVALUATIONS,
  poka_yoke_evaluations: TokenType.POKA_YOKE_EVALUATIONS,
  spc_chart_state: TokenType.SPC_CHART_STATE,
  andon_firings: TokenType.ANDON_FIRINGS,
  ai_observations: TokenType.AI_OBSERVATIONS,
  ai_proposals: TokenType.AI_PROPOSALS,
  operator_actions: TokenType.OPERATOR_ACTIONS,
  recovery_executions: TokenType.RECOVERY_EXECUTIONS,

  // Primitive types
  string: TokenType.STRING,
  number: TokenType.NUMBER,
  float: TokenType.FLOAT,
  bool: TokenType.BOOL,
  date: TokenType.DATE,
  datetime: TokenType.DATETIME,
  id: TokenType.ID,

  // Predicate language
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  IN: TokenType.IN,
  IS_NULL: TokenType.IS_NULL,
  IS_NOT_NULL: TokenType.IS_NOT_NULL,
  MATCHES: TokenType.MATCHES,
  MATCHING: TokenType.MATCHING,
  PROPOSE_REVIEW: TokenType.PROPOSE_REVIEW,

  // Booleans
  true: TokenType.TRUE,
  false: TokenType.FALSE,
};

// Duration unit suffixes recognized after a numeric literal preceded by underscore
const DURATION_UNITS = new Set([
  'seconds',
  'minutes',
  'hours',
  'days',
  'months',
  'years',
]);

// =============================================================================
// LEXER
// =============================================================================

export class Lexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];
      const startLoc: SourceLocation = { line: this.line, column: this.col };

      // String literal
      if (ch === '"') {
        this.readStringLiteral(startLoc);
        continue;
      }

      // Numeric literal (possibly a duration literal)
      if (this.isDigit(ch)) {
        this.readNumericOrDuration(startLoc);
        continue;
      }

      // Negative numeric literal: a leading `-` immediately followed by a
      // digit or decimal point (e.g. `LOWER -5.0`, `x > -1`). A bare `-` with
      // no digit after it is still an error (QC has no subtraction operator).
      if (ch === '-') {
        const next = this.peek(1);
        if (next !== undefined && (this.isDigit(next) || next === '.')) {
          this.advance(); // consume '-'
          this.readNumericOrDuration(startLoc, true);
          continue;
        }
      }

      // Identifier, keyword, or CONTAINS_* predicate
      if (this.isIdentStart(ch)) {
        this.readIdentifierOrKeyword(startLoc);
        continue;
      }

      // Punctuation / operators
      switch (ch) {
        case '{':
          this.pushToken(TokenType.LBRACE, '{', startLoc);
          this.advance();
          continue;
        case '}':
          this.pushToken(TokenType.RBRACE, '}', startLoc);
          this.advance();
          continue;
        case '[':
          this.pushToken(TokenType.LBRACKET, '[', startLoc);
          this.advance();
          continue;
        case ']':
          this.pushToken(TokenType.RBRACKET, ']', startLoc);
          this.advance();
          continue;
        case '(':
          this.pushToken(TokenType.LPAREN, '(', startLoc);
          this.advance();
          continue;
        case ')':
          this.pushToken(TokenType.RPAREN, ')', startLoc);
          this.advance();
          continue;
        case ',':
          this.pushToken(TokenType.COMMA, ',', startLoc);
          this.advance();
          continue;
        case ':':
          this.pushToken(TokenType.COLON, ':', startLoc);
          this.advance();
          continue;
        case '.':
          this.pushToken(TokenType.DOT, '.', startLoc);
          this.advance();
          continue;
        case '=':
          if (this.peek(1) === '=') {
            this.pushToken(TokenType.EQ, '==', startLoc);
            this.advance();
            this.advance();
          } else {
            this.pushToken(TokenType.ASSIGN, '=', startLoc);
            this.advance();
          }
          continue;
        case '!':
          if (this.peek(1) === '=') {
            this.pushToken(TokenType.NEQ, '!=', startLoc);
            this.advance();
            this.advance();
            continue;
          }
          throw new LexerError(`Unexpected character: '!'`, startLoc);
        case '<':
          if (this.peek(1) === '=') {
            this.pushToken(TokenType.LTE, '<=', startLoc);
            this.advance();
            this.advance();
          } else {
            this.pushToken(TokenType.LT, '<', startLoc);
            this.advance();
          }
          continue;
        case '>':
          if (this.peek(1) === '=') {
            this.pushToken(TokenType.GTE, '>=', startLoc);
            this.advance();
            this.advance();
          } else {
            this.pushToken(TokenType.GT, '>', startLoc);
            this.advance();
          }
          continue;
      }

      throw new LexerError(`Unexpected character: '${ch}'`, startLoc);
    }

    this.pushToken(TokenType.EOF, '', { line: this.line, column: this.col });
    return this.tokens;
  }

  // --- Helpers ---

  private advance(): void {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentCont(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === '-';
  }

  private pushToken(type: TokenType, value: string, location: SourceLocation): void {
    this.tokens.push({ type, value, location });
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
      } else if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this.advance();
        }
      } else if (ch === '/' && this.peek(1) === '*') {
        this.advance(); // consume /
        this.advance(); // consume *
        while (this.pos < this.source.length) {
          if (this.source[this.pos] === '*' && this.peek(1) === '/') {
            this.advance();
            this.advance();
            break;
          }
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private readStringLiteral(startLoc: SourceLocation): void {
    this.advance(); // consume opening "
    const chars: string[] = [];
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      const ch = this.source[this.pos];
      if (ch === '\\') {
        const next = this.peek(1);
        if (next === '\n') {
          // line continuation — skip backslash, newline, and following indentation
          this.advance(); // \
          this.advance(); // \n
          while (this.pos < this.source.length && (this.source[this.pos] === ' ' || this.source[this.pos] === '\t')) {
            this.advance();
          }
          continue;
        }
        if (next === 'n') {
          chars.push('\n');
          this.advance();
          this.advance();
          continue;
        }
        if (next === 't') {
          chars.push('\t');
          this.advance();
          this.advance();
          continue;
        }
        if (next === '"') {
          chars.push('"');
          this.advance();
          this.advance();
          continue;
        }
        if (next === '\\') {
          chars.push('\\');
          this.advance();
          this.advance();
          continue;
        }
        chars.push(ch);
        this.advance();
      } else {
        chars.push(ch);
        this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw new LexerError('Unterminated string literal', startLoc);
    }
    this.advance(); // consume closing "
    this.pushToken(TokenType.STRING_LITERAL, chars.join(''), startLoc);
  }

  private readNumericOrDuration(startLoc: SourceLocation, negative = false): void {
    let buf = negative ? '-' : '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (this.isDigit(ch) || ch === '.' || ch === '_') {
        buf += ch;
        this.advance();
      } else {
        break;
      }
    }

    // Duration check: the last underscore in buf may be followed by a unit
    // (e.g., "7_years"). The unit identifier follows immediately after the
    // numeric body. We detect it by looking at the just-consumed buffer:
    // if it ends with _, the unit is the next identifier-like word.
    if (buf.endsWith('_')) {
      // Re-scan: peek ahead for unit
      const restoreLine = this.line;
      const restoreCol = this.col;
      const restorePos = this.pos;
      let unit = '';
      while (this.pos < this.source.length && this.isIdentCont(this.source[this.pos]!)) {
        unit += this.source[this.pos];
        this.advance();
      }
      if (DURATION_UNITS.has(unit)) {
        const valueStr = buf.slice(0, -1).replace(/_/g, '');
        this.pushToken(TokenType.DURATION_LITERAL, `${valueStr}_${unit}`, startLoc);
        return;
      }
      // Roll back; the underscore was just a separator inside a numeric literal.
      this.pos = restorePos;
      this.line = restoreLine;
      this.col = restoreCol;
    } else if (this.pos < this.source.length && this.source[this.pos] === '_') {
      // duration like 7_years where buf ends in digit
      const restoreLine = this.line;
      const restoreCol = this.col;
      const restorePos = this.pos;
      this.advance(); // consume _
      let unit = '';
      while (this.pos < this.source.length && this.isIdentCont(this.source[this.pos]!)) {
        unit += this.source[this.pos];
        this.advance();
      }
      if (DURATION_UNITS.has(unit)) {
        const valueStr = buf.replace(/_/g, '');
        this.pushToken(TokenType.DURATION_LITERAL, `${valueStr}_${unit}`, startLoc);
        return;
      }
      this.pos = restorePos;
      this.line = restoreLine;
      this.col = restoreCol;
    }

    const cleaned = buf.replace(/_/g, '');
    this.pushToken(TokenType.NUMBER_LITERAL, cleaned, startLoc);
  }

  private readIdentifierOrKeyword(startLoc: SourceLocation): void {
    let buf = '';
    while (this.pos < this.source.length && this.isIdentCont(this.source[this.pos]!)) {
      buf += this.source[this.pos];
      this.advance();
    }

    // CONTAINS_* family — extensible predicate registry.
    // Any identifier matching /^CONTAINS_[A-Z_]+$/ is a CONTAINS_PREDICATE token.
    if (/^CONTAINS_[A-Z_]+$/.test(buf)) {
      this.pushToken(TokenType.CONTAINS_PREDICATE, buf, startLoc);
      return;
    }

    // Keyword lookup — exact match first, then case-insensitive fallback
    // for known case-sensitive keywords like uppercase declaration types.
    const keywordType = KEYWORDS[buf];
    if (keywordType !== undefined) {
      this.pushToken(keywordType, buf, startLoc);
      return;
    }

    this.pushToken(TokenType.IDENTIFIER, buf, startLoc);
  }
}
