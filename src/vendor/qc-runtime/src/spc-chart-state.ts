// SPC chart state and Western Electric rule evaluation.
//
// Each SPC_CHART declaration in a .qc file gets a SpcChartState instance at
// runtime. The state holds:
//   - A rolling window of recent sample measurements
//   - The chart's center line (mean of baseline samples)
//   - The chart's 1σ/2σ/3σ control limits (computed from baseline stddev)
//   - The recent history of "which side of centerline" for run-length rules
//
// The baseline is established from the first `sample_size` measurements.
// After that, every new measurement is evaluated against the active Western
// Electric rules and any rule violation fires the chart's ON_RULE_VIOLATION
// action.
//
// First-cut implementation supports Western Electric rules 1, 2, 5, and 6
// per the QC grammar's `rules_1_2` and `rules_1_2_5_6` sets. Rule 1 is the
// demo-friendly one (single point beyond 3σ), which is sufficient for the
// Help Desk Demo's Button 7 (Goal Drift).

import type { SpcChartDecl, WesternElectricRuleSet } from '../../qc-parser/src/index.js';

export type Side = 'above' | 'below' | 'on';

export interface RuleViolation {
  rule: 'rule_1' | 'rule_2' | 'rule_5' | 'rule_6';
  description: string;
}

export interface SpcSample {
  value: number;
  side: Side;
  timestamp: number;
}

export class SpcChartState {
  private decl: SpcChartDecl;
  // Established control parameters
  private centerLine: number | null = null;
  private stdDev: number | null = null;
  // Rolling buffer (capped at a generous size for run-length checks)
  private samples: SpcSample[] = [];
  // Baseline phase: first `sample_size` samples used to compute center+stddev
  private baselineSamples: number[] = [];

  // Max history we retain for rules (rule 2 needs 9; rule 6 needs 5).
  // Keep 20 to allow for diagnostics.
  private static readonly HISTORY = 20;

  constructor(decl: SpcChartDecl) {
    this.decl = decl;
  }

  getDecl(): SpcChartDecl {
    return this.decl;
  }

  inBaseline(): boolean {
    return this.centerLine === null;
  }

  /**
   * Observe a new measurement. If baseline is not yet established, accumulates
   * toward the baseline; once baseline is complete, evaluates the active
   * Western Electric rules and returns any violation that fires.
   */
  observe(value: number, timestamp: number): RuleViolation | null {
    if (this.centerLine === null) {
      this.baselineSamples.push(value);
      if (this.baselineSamples.length >= this.decl.sampleSize) {
        this.establishBaseline();
      }
      return null;
    }

    const side = this.classifySide(value);
    this.samples.push({ value, side, timestamp });
    // Cap history
    if (this.samples.length > SpcChartState.HISTORY) {
      this.samples = this.samples.slice(this.samples.length - SpcChartState.HISTORY);
    }

    return this.evaluateRules();
  }

  /**
   * Manually seed the baseline (useful for tests that want to skip the
   * accumulation phase).
   */
  setBaselineDirectly(centerLine: number, stdDev: number): void {
    this.centerLine = centerLine;
    this.stdDev = stdDev;
  }

  private establishBaseline(): void {
    const n = this.baselineSamples.length;
    const mean = this.baselineSamples.reduce((a, b) => a + b, 0) / n;
    const variance =
      this.baselineSamples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
    this.centerLine = mean;
    this.stdDev = Math.sqrt(variance);
    // Don't keep baseline samples in the rolling history; they predate the
    // monitoring phase. Subsequent run-length rules start from the next sample.
  }

  private classifySide(value: number): Side {
    if (this.centerLine === null) return 'on';
    if (value > this.centerLine) return 'above';
    if (value < this.centerLine) return 'below';
    return 'on';
  }

  private evaluateRules(): RuleViolation | null {
    const ruleSet = this.decl.westernElectric;

    // Rule 1 — one point outside 3σ. Always evaluated (in all rule sets).
    const rule1 = this.checkRule1();
    if (rule1) return rule1;

    if (ruleSet === 'none') return null;

    // Rule 2 — nine consecutive points on one side of center
    const rule2 = this.checkRule2();
    if (rule2) return rule2;

    if (ruleSet === 'rules_1_2') return null;

    // Rules 5 and 6 (rules_1_2_5_6 and all)
    const rule5 = this.checkRule5();
    if (rule5) return rule5;

    const rule6 = this.checkRule6();
    if (rule6) return rule6;

    return null;
  }

  private checkRule1(): RuleViolation | null {
    if (this.centerLine === null || this.stdDev === null) return null;
    const last = this.samples[this.samples.length - 1];
    if (!last) return null;
    const zScore = Math.abs(last.value - this.centerLine) / (this.stdDev || 1e-9);
    if (zScore > 3) {
      return {
        rule: 'rule_1',
        description: `point ${last.value.toFixed(3)} is ${zScore.toFixed(2)}σ from center ${this.centerLine.toFixed(3)} (beyond 3σ limit)`,
      };
    }
    return null;
  }

  private checkRule2(): RuleViolation | null {
    // Nine consecutive points on one side of centerline
    if (this.samples.length < 9) return null;
    const last9 = this.samples.slice(-9);
    if (last9.every((s) => s.side === 'above')) {
      return {
        rule: 'rule_2',
        description: 'nine consecutive points above center — sustained drift',
      };
    }
    if (last9.every((s) => s.side === 'below')) {
      return {
        rule: 'rule_2',
        description: 'nine consecutive points below center — sustained drift',
      };
    }
    return null;
  }

  private checkRule5(): RuleViolation | null {
    // Two of three consecutive points outside 2σ on same side
    if (this.centerLine === null || this.stdDev === null) return null;
    if (this.samples.length < 3) return null;
    const last3 = this.samples.slice(-3);
    const above2sigma = last3.filter(
      (s) => s.value > this.centerLine! + 2 * this.stdDev!
    ).length;
    const below2sigma = last3.filter(
      (s) => s.value < this.centerLine! - 2 * this.stdDev!
    ).length;
    if (above2sigma >= 2) {
      return {
        rule: 'rule_5',
        description: 'two of three consecutive points more than 2σ above center',
      };
    }
    if (below2sigma >= 2) {
      return {
        rule: 'rule_5',
        description: 'two of three consecutive points more than 2σ below center',
      };
    }
    return null;
  }

  private checkRule6(): RuleViolation | null {
    // Four of five consecutive points outside 1σ on same side
    if (this.centerLine === null || this.stdDev === null) return null;
    if (this.samples.length < 5) return null;
    const last5 = this.samples.slice(-5);
    const above1sigma = last5.filter(
      (s) => s.value > this.centerLine! + 1 * this.stdDev!
    ).length;
    const below1sigma = last5.filter(
      (s) => s.value < this.centerLine! - 1 * this.stdDev!
    ).length;
    if (above1sigma >= 4) {
      return {
        rule: 'rule_6',
        description: 'four of five consecutive points more than 1σ above center',
      };
    }
    if (below1sigma >= 4) {
      return {
        rule: 'rule_6',
        description: 'four of five consecutive points more than 1σ below center',
      };
    }
    return null;
  }

  // Diagnostics
  getCenterLine(): number | null {
    return this.centerLine;
  }
  getStdDev(): number | null {
    return this.stdDev;
  }
  getSampleCount(): number {
    return this.samples.length;
  }
  getBaselineProgress(): { current: number; needed: number } {
    return { current: this.baselineSamples.length, needed: this.decl.sampleSize };
  }
}

// Helper: which rule sets activate which rules
export function rulesActiveIn(set: WesternElectricRuleSet): Set<string> {
  switch (set) {
    case 'none':
      return new Set();
    case 'rules_1_2':
      return new Set(['rule_1', 'rule_2']);
    case 'rules_1_2_5_6':
    case 'all':
      return new Set(['rule_1', 'rule_2', 'rule_5', 'rule_6']);
  }
}
