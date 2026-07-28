// Reactive wrapper around the BillingLoop. The loop is the engine; this store
// snapshots it after every tick so React re-renders. Auto-run drives ticks on
// an interval.

import { create } from "zustand";
import starterSource from "../harness/billing-starter.qc?raw";
import { BillingLoop, type LoopMetrics, type TickResult } from "../lib/billing-loop";
import type { LedgerEntry } from "../lib/ledger";
import { adjudicate, type Remit } from "../lib/payer";
import { CONFLICTING_PAIR } from "../lib/analysis";

const SEED = 7;

interface LoopStore {
  loop: BillingLoop;
  last: TickResult | null;
  /** The remittance for the last claim (recomputed for the message panel). */
  lastRemit: Remit | null;
  metrics: LoopMetrics;
  denialRate: number;
  ledger: readonly LedgerEntry[];
  harness: string;
  learned: string[];
  running: boolean;
  ticks: number;
  /** Bumps whenever a rule deploys — lets the harness panel flash the new rule. */
  lastDeployField: string | null;

  /** Splice in the two-rule conflict the replay gate cannot see. Demo only. */
  injectConflict: () => void;
  tick: () => Promise<void>;
  run: (n: number) => Promise<void>;
  toggleAuto: () => void;
  reset: () => void;
}

let autoTimer: ReturnType<typeof setInterval> | null = null;

function snapshot(loop: BillingLoop, last: TickResult | null): Partial<LoopStore> {
  // A held/paid claim has no remit denial; a submitted claim we can re-adjudicate
  // for the 835 panel (pure function of the claim).
  const lastRemit = last ? (last.remit ?? (last.stage === "held" ? null : adjudicate(last.claim))) : null;
  return {
    last,
    lastRemit,
    metrics: { ...loop.metrics },
    denialRate: loop.denialRate(),
    ledger: loop.ledgerEntries(),
    harness: loop.source,
    learned: loop.learnedFields(),
    ticks: loop.metrics.processed,
    lastDeployField: last?.stage === "denied_deployed" ? last.proposal?.field ?? null : null,
  };
}

export const useLoopStore = create<LoopStore>((set, get) => {
  const loop = new BillingLoop(starterSource, { seed: SEED });
  return {
    loop,
    last: null,
    lastRemit: null,
    metrics: { ...loop.metrics },
    denialRate: 0,
    ledger: loop.ledgerEntries(),
    harness: loop.source,
    learned: [],
    running: false,
    ticks: 0,
    lastDeployField: null,

    injectConflict: () => {
      get().loop.appendRules(CONFLICTING_PAIR);
      set(snapshot(get().loop, get().last));
    },

    tick: async () => {
      const result = await get().loop.tick();
      set(snapshot(get().loop, result));
    },

    run: async (n) => {
      const loop = get().loop;
      let last: TickResult | null = get().last;
      for (let i = 0; i < n; i++) last = await loop.tick();
      set(snapshot(loop, last));
    },

    toggleAuto: () => {
      const running = !get().running;
      set({ running });
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      if (running) {
        autoTimer = setInterval(() => { void get().tick(); }, 900);
      }
    },

    reset: () => {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      const loop = new BillingLoop(starterSource, { seed: SEED });
      set({
        loop, last: null, lastRemit: null, metrics: { ...loop.metrics },
        denialRate: 0, ledger: loop.ledgerEntries(), harness: loop.source,
        learned: [], running: false, ticks: 0, lastDeployField: null,
      });
    },
  };
});
