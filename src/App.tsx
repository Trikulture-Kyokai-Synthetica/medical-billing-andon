import { useLoopStore } from "./store/loop-store";
import { messagesFor } from "./lib/edi";
import { ALL_BILLING_FIELDS, carcForField } from "./lib/carc";
import type { TickStage } from "./lib/billing-loop";
import type { LedgerEntry, LedgerKind } from "./lib/ledger";

// ── Header + controls ────────────────────────────────────────────────────────

function Header() {
  const { running, tick, run, toggleAuto, reset, ticks } = useLoopStore();
  return (
    <header className="hdr">
      <div className="hdr-title">
        <h1>Revenue-Cycle Andon Loop</h1>
        <p>A claim scrubber that learns to prevent payer denials — running on the real Agicore QC harness.</p>
      </div>
      <div className="controls">
        <span className="tick-count">{ticks} claims</span>
        <button onClick={() => void tick()} disabled={running}>Next claim</button>
        <button onClick={() => void run(20)} disabled={running}>Run 20</button>
        <button className={running ? "on" : ""} onClick={toggleAuto}>{running ? "Pause" : "Auto-run"}</button>
        <button className="ghost" onClick={reset}>Reset</button>
      </div>
    </header>
  );
}

// ── Pipeline floor ───────────────────────────────────────────────────────────

const STAGE_STATION: Record<TickStage, number> = {
  held: 1, paid: 4,
  denied_deployed: 5, denied_tier_rejected: 5, denied_sandbox_rejected: 5, denied_known: 5,
};

const STATIONS = ["Charge (HL7)", "Scrub", "Submit (837)", "Adjudicate (835)", "Outcome", "Andon Loop"];

function outcomeLabel(stage: TickStage): { text: string; cls: string } {
  switch (stage) {
    case "held": return { text: "HELD — caught at source", cls: "ok-held" };
    case "paid": return { text: "PAID", cls: "ok-paid" };
    case "denied_deployed": return { text: "DENIED → rule learned", cls: "bad" };
    case "denied_tier_rejected": return { text: "DENIED → proposal rejected (tier)", cls: "bad" };
    case "denied_sandbox_rejected": return { text: "DENIED → proposal rejected (sandbox)", cls: "bad" };
    case "denied_known": return { text: "DENIED", cls: "bad" };
  }
}

function PipelineFloor() {
  const { last } = useLoopStore();
  const active = last ? STAGE_STATION[last.stage] : -1;
  return (
    <section className="floor panel">
      <div className="panel-h">Revenue cycle</div>
      <div className="stations">
        {STATIONS.map((s, i) => (
          <div key={s} className={`station ${i <= active ? "lit" : ""} ${i === active ? "cur" : ""}`}>
            <span className="station-n">{i + 1}</span>
            <span className="station-name">{s}</span>
          </div>
        ))}
      </div>
      {last && (
        <div className="current-claim">
          <div className="cc-id">
            <span className="mono">{last.claim.claimId}</span>
            <span className="cc-meta">{last.claim.cpt} · {last.claim.payer} · ${last.claim.chargeUsd.toFixed(2)}</span>
          </div>
          <div className={`cc-outcome ${outcomeLabel(last.stage).cls}`}>{outcomeLabel(last.stage).text}</div>
        </div>
      )}
      {!last && <div className="empty">Click <strong>Next claim</strong> to send a claim through the cycle.</div>}
    </section>
  );
}

// ── Metrics + denial gauge ───────────────────────────────────────────────────

function Metrics() {
  const { metrics, denialRate, learned } = useLoopStore();
  const pct = (denialRate * 100).toFixed(1);
  const learnedCount = ALL_BILLING_FIELDS.filter((f) => !["modifier_present", "prior_auth_present"].includes(f) && learned.includes(f)).length;
  const learnable = ALL_BILLING_FIELDS.length - 2;
  return (
    <section className="metrics panel">
      <div className="panel-h">Denial rate</div>
      <div className="gauge">
        <div className="gauge-num" style={{ color: denialRate === 0 && metrics.submitted > 0 ? "var(--paid)" : "var(--deny)" }}>{pct}<span>%</span></div>
        <div className="gauge-sub">of submitted claims denied</div>
        <div className="gauge-bar"><div className="gauge-fill" style={{ width: `${Math.min(100, denialRate * 100)}%` }} /></div>
      </div>
      <div className="counts">
        <Stat label="Held at source" value={metrics.held} cls="ok-held" />
        <Stat label="Submitted" value={metrics.submitted} />
        <Stat label="Paid" value={metrics.paid} cls="ok-paid" />
        <Stat label="Denied" value={metrics.denied} cls="bad" />
      </div>
      <div className="learned-progress">
        <span>Scrub rules learned</span>
        <span className="mono">{learnedCount} / {learnable}</span>
      </div>
    </section>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls?: string }) {
  return (
    <div className="stat">
      <div className={`stat-v ${cls ?? ""}`}>{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

// ── Andon section (denial → proposal → pipeline) ─────────────────────────────

function AndonSection() {
  const { last } = useLoopStore();
  if (!last || last.stage === "held" || last.stage === "paid") return null;
  const carc = last.remit?.carc;
  const proposal = last.proposal;
  const deployed = last.stage === "denied_deployed";
  const rejected = last.stage.includes("rejected");
  return (
    <section className={`andon panel ${deployed ? "deployed" : rejected ? "rejected" : ""}`}>
      <div className="andon-cord"><span className="cord-dot" /> ANDON CORD PULLED</div>
      {carc && (
        <div className="andon-row">
          <span className="tag deny">{carc.code}</span>
          <span>{carc.description}</span>
        </div>
      )}
      {proposal && (
        <div className="proposal">
          <div className="proposal-h">AI proposes a scrub rule</div>
          <div className="proposal-body">{proposal.rationale}</div>
          <div className="pipeline-steps">
            <Step ok={!last.stage.includes("tier_rejected")} label="Tier-verify" />
            <Step ok={deployed} fail={last.stage === "denied_sandbox_rejected"} label="Sandbox regression" />
            <Step ok={deployed} label="Deploy" />
          </div>
          {deployed && <div className="deployed-note">Rule <span className="mono">learned_{proposal.field}</span> deployed. This denial class can never recur.</div>}
        </div>
      )}
    </section>
  );
}

function Step({ ok, fail, label }: { ok: boolean; fail?: boolean; label: string }) {
  return <span className={`pstep ${ok ? "done" : fail ? "failed" : "pending"}`}>{label}</span>;
}

// ── Message panels (HL7 / 837 / 835) ─────────────────────────────────────────

function MessagePanels() {
  const { last, lastRemit } = useLoopStore();
  if (!last) return <section className="messages panel"><div className="panel-h">Messages</div><div className="empty">EDI + HL7 for the current claim appear here.</div></section>;
  const msgs = messagesFor(last.claim, lastRemit);
  return (
    <section className="messages panel">
      <div className="panel-h">Messages — synthetic, no PHI</div>
      <Msg title="HL7 v2 · DFT^P03 charge" body={msgs.hl7} />
      <Msg title="X12 837 · outbound claim" body={msgs.x837} />
      {msgs.x835 ? (
        <Msg title="X12 835 · remittance" body={msgs.x835} highlight={lastRemit?.status === "denied" ? "CAS" : undefined} />
      ) : (
        <div className="msg"><div className="msg-t">X12 835 · remittance</div><div className="msg-b muted">— held before submission; no remittance —</div></div>
      )}
    </section>
  );
}

function Msg({ title, body, highlight }: { title: string; body: string; highlight?: string }) {
  return (
    <div className="msg">
      <div className="msg-t">{title}</div>
      <pre className="msg-b">
        {body.split("\n").map((line, i) => (
          <div key={i} className={highlight && line.startsWith(highlight) ? "seg-hot" : undefined}>{line}</div>
        ))}
      </pre>
    </div>
  );
}

// ── Harness panel (the .qc growing) ──────────────────────────────────────────

function HarnessPanel() {
  const { learned, lastDeployField } = useLoopStore();
  const rules = [
    { field: "modifier_present", starter: true },
    { field: "prior_auth_present", starter: true },
    ...learned.map((f) => ({ field: f, starter: false })),
  ];
  return (
    <section className="harness panel">
      <div className="panel-h">Live scrub rules (billing.qc)</div>
      <div className="rules">
        {rules.map((r) => {
          const carc = carcForField(r.field);
          return (
            <div key={r.field} className={`rule ${r.starter ? "starter" : "learned"} ${r.field === lastDeployField ? "flash" : ""}`}>
              <span className="rule-req">REQUIRES <span className="mono">{r.field}</span></span>
              <span className="rule-meta">{r.starter ? "starter" : `learned · ${carc?.code ?? ""}`}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Ledger ───────────────────────────────────────────────────────────────────

const KIND_ICON: Record<LedgerKind, string> = {
  claim_submitted: "→", claim_held: "⛔", claim_paid: "✓", claim_denied: "✗",
  andon_pulled: "▲", proposal: "◆", tier_verified: "①", tier_rejected: "✗",
  sandbox_passed: "②", sandbox_rejected: "✗", deployed: "★",
};

function LedgerPanel() {
  const { ledger } = useLoopStore();
  const recent = [...ledger].slice(-40).reverse();
  return (
    <section className="ledger panel">
      <div className="panel-h">Hash-chained audit ledger <span className="chain-badge">tamper-evident</span></div>
      <div className="ledger-list">
        {recent.length === 0 && <div className="empty">Every event is hash-chained here.</div>}
        {recent.map((e) => <LedgerRow key={e.seq} e={e} />)}
      </div>
    </section>
  );
}

function LedgerRow({ e }: { e: LedgerEntry }) {
  const p = e.payload as Record<string, unknown>;
  const detail =
    e.kind === "claim_denied" ? `${p.claimId} · ${p.carc}` :
    e.kind === "deployed" ? `learned_${p.field}` :
    e.kind === "proposal" ? String(p.field) :
    p.claimId ? String(p.claimId) : "";
  return (
    <div className={`lrow k-${e.kind}`}>
      <span className="lrow-i">{KIND_ICON[e.kind]}</span>
      <span className="lrow-k">{e.kind.replace(/_/g, " ")}</span>
      <span className="lrow-d">{detail}</span>
      <span className="lrow-h mono" title={e.hash}>{e.hash.slice(0, 8)}</span>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="grid">
        <div className="col-left">
          <PipelineFloor />
          <AndonSection />
          <MessagePanels />
        </div>
        <div className="col-right">
          <Metrics />
          <HarnessPanel />
          <LedgerPanel />
        </div>
      </main>
      <footer className="foot">
        Synthetic data only — no PHI. The scrubber runs the vendored Agicore <span className="mono">qc-runtime</span>; each payer denial teaches it a new rule, vetted through a deterministic mutation pipeline and hash-chained into the audit trail.
      </footer>
    </div>
  );
}
