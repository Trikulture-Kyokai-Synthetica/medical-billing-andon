// Agicore QC Dialect Parser — Public API
//
// See README.md and agicore/QC_DIALECT.md for an overview.

export { Parser, ParseError } from './parser.js';
export { Lexer, LexerError, TokenType } from './lexer.js';
export type { Token } from './lexer.js';
export { validate } from './validator.js';
export { analyze } from './analyzer.js';
export type {
  AnalysisResult, PointAnalysis, AnalyzeOptions, AtomInfo, AtomKind, Witness, DeadClass,
} from './analyzer.js';
export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationErrorKind,
} from './validator.js';
export type {
  QcFile,
  QcDeclaration,
  // Declaration types
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
  // Supporting types
  CaptureField,
  PermittedObservation,
  PermittedProposal,
  // Predicate language
  PredicateExpr,
  ComparisonPredicate,
  MembershipPredicate,
  NullCheckPredicate,
  ContainsPredicate,
  MatchesPredicate,
  BooleanCombinator,
  ParenthesizedPredicate,
  FieldPath,
  IdentifierRef,
  LiteralValue,
  // Action and recovery
  TriggerAction,
  AndonRef,
  ProposeReviewRef,
  RecoveryAction,
  GracefulFallback,
  RetryWithValidTool,
  RouteToDefaultHumanQueue,
  ManualRecovery,
  CustomRecovery,
  // Value types
  QcPrimitiveType,
  SeverityLevel,
  ChartType,
  WesternElectricRuleSet,
  ColorTag,
  Scope,
  StorageMode,
  ExportFormat,
  TimestampPrecision,
  ProvenanceChainMode,
  TamperEvidentMode,
  SandboxMode,
  AuditLevel,
  AccessLevel,
  SystemKind,
  EventBridgeKind,
  CaptureClass,
  Duration,
  // Source tracking
  SourceLocation,
  SourceSpan,
  ParseError as ParseErrorType,
} from './types.js';

import { Parser } from './parser.js';
import type { QcFile } from './types.js';

/**
 * Parse an Agicore .qc source string into a typed AST.
 *
 * @param source - The .qc file contents
 * @returns The parsed QcFile AST
 * @throws ParseError if the source is invalid
 */
export function parse(source: string): QcFile {
  const parser = new Parser();
  return parser.parse(source);
}
