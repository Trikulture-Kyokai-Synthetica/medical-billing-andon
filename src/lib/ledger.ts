// The mutation ledger — an append-only, SHA-256 hash-chained record of every
// event in the andon loop. This is the compliance artifact: it makes the
// history of the scrubber's rule changes tamper-evident. Any alteration of a
// past entry breaks the chain from that point forward, so "who changed which
// rule, when, and on what evidence" has a cryptographic answer.
//
// Matches the AUDIT_TRAIL declaration in the harness (TAMPER_EVIDENT hash_anchored).

export type LedgerKind =
  | "claim_submitted"
  | "claim_held" // scrubber caught it pre-submission
  | "claim_paid"
  | "claim_denied" // payer denied — the defect that escaped
  | "andon_pulled"
  | "proposal"
  | "tier_verified"
  | "tier_rejected"
  | "sandbox_passed"
  | "sandbox_rejected"
  | "deployed";

export interface LedgerEntry {
  seq: number;
  kind: LedgerKind;
  ts: number;
  payload: Record<string, unknown>;
  /** Hex SHA-256 of (previous hash + canonical payload). Genesis uses 64 zeros. */
  hash: string;
  prevHash: string;
}

const GENESIS = "0".repeat(64);

async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalize(payload: Record<string, unknown>): string {
  // Stable key ordering so the hash is reproducible regardless of insertion order.
  return JSON.stringify(payload, Object.keys(payload).sort());
}

export class Ledger {
  private entries: LedgerEntry[] = [];

  async append(kind: LedgerKind, ts: number, payload: Record<string, unknown>): Promise<LedgerEntry> {
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
    const seq = this.entries.length;
    const hash = await sha256Hex(prevHash + canonicalize({ ...payload, __kind: kind, __seq: seq, __ts: ts }));
    const entry: LedgerEntry = { seq, kind, ts, payload, hash, prevHash };
    this.entries.push(entry);
    return entry;
  }

  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  /** Re-derive every hash and confirm the chain is intact — the tamper check. */
  async verify(): Promise<{ ok: boolean; brokenAt: number | null }> {
    let prev = GENESIS;
    for (const e of this.entries) {
      const expected = await sha256Hex(prev + canonicalize({ ...e.payload, __kind: e.kind, __seq: e.seq, __ts: e.ts }));
      if (expected !== e.hash || e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true, brokenAt: null };
  }
}
