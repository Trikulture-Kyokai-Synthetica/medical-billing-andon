// Console interface for the medical-billing andon loop. Attaches a `demo`
// object to window so the whole loop is exercisable from the browser console
// before (and alongside) the UI:
//
//   demo.run(20)     // process 20 claims through the revenue cycle
//   demo.tick()      // one claim
//   demo.metrics()   // denial rate, rules learned, held-at-source, etc.
//   demo.harness()   // the current .qc harness source (grows as it learns)
//   demo.learned()   // the scrub rules the loop has learned from denials
//   demo.ledger()    // the hash-chained mutation ledger
//   demo.verify()    // re-derive the chain and confirm it's intact
//   demo.reset(seed) // fresh loop from the starter harness
//   demo.loop        // the live BillingLoop instance

import starterSource from "../harness/billing-starter.qc?raw";
import { BillingLoop } from "./billing-loop";

let loop = new BillingLoop(starterSource, { seed: 1 });

function metrics() {
  return {
    ...loop.metrics,
    denialRate: `${(loop.denialRate() * 100).toFixed(1)}%`,
    learnedRules: loop.learnedFields(),
  };
}

const api = {
  get loop() { return loop; },
  tick: () => loop.tick(),
  run: (n = 10) => loop.run(n),
  metrics,
  harness: () => loop.source,
  learned: () => loop.learnedFields(),
  ledger: () => loop.ledgerEntries(),
  verify: () => loop.verifyLedger(),
  reset: (seed = 1) => {
    loop = new BillingLoop(starterSource, { seed });
    return "loop reset from starter harness";
  },
};

declare global {
  interface Window {
    demo: typeof api;
  }
}

if (typeof window !== "undefined") {
  window.demo = api;
  // eslint-disable-next-line no-console
  console.log(
    "%cRevenue-Cycle Andon Loop%c — try demo.run(20), then demo.metrics(). demo.harness() shows the .qc it's learned.",
    "font-weight:bold", "font-weight:normal",
  );
}

export { loop };
