import { Code2, Globe2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { capabilityCode, type Agent } from "../demo";
import { LiveBrowser } from "./LiveBrowser";

type Props = {
  agent: Agent;
  tab: "browser" | "capability";
  setTab: (tab: "browser" | "capability") => void;
  visible: boolean;
  onReplay: () => void;
};

export function BrowserPanel({ agent, tab, setTab, visible, onReplay }: Props) {
  const [copied, setCopied] = useState(false);
  const finished = ["ready", "finished", "replaying"].includes(agent.phase);
  const statement = agent.kind === "statement";
  async function copyCapability() {
    try {
      await navigator.clipboard.writeText(capabilityCode(agent.kind));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="browser-panel" aria-label="Session workspace">
      <header className="panel-header">
        <div className="view-tabs" aria-label="Session views">
          <button
            aria-pressed={tab === "browser"}
            onClick={() => setTab("browser")}
          >
            <Globe2 size={15} />
            Browser
          </button>
          <button
            aria-pressed={tab === "capability"}
            onClick={() => setTab("capability")}
          >
            <Code2 size={15} />
            Capability{finished && <span className="tab-dot" />}
          </button>
        </div>
        {tab === "capability" && <span className="sample-label">DEMO</span>}
      </header>

      {tab === "capability" ? (
        <div className="capability-view">
          <div className="capability-icon">
            <Code2 size={25} strokeWidth={1.5} />
          </div>
          <span className="eyebrow">
            {finished ? "SAVED CAPABILITY" : "CAPABILITY PREVIEW"}
          </span>
          <h2>{statement ? "Find a statement." : "Learn once. Run again."}</h2>
          <p>
            {finished
              ? "The workflow has a shape now. New inputs, the same verified steps."
              : "A successful run becomes a reusable workflow. Finish the handoff to see the saved state."}
          </p>
          <div className="code-card">
            <div className="code-header">
              <span>
                {statement
                  ? "find_latest_statement"
                  : "prepare_savings_account"}
              </span>
              <span>v1 · {finished ? "saved" : "draft"}</span>
            </div>
            <pre>{capabilityCode(agent.kind)}</pre>
          </div>
          <div className="capability-actions">
            <button
              className="primary-button"
              disabled={!finished || agent.phase === "replaying"}
              onClick={onReplay}
            >
              <RotateCcw size={15} />
              {agent.phase === "replaying" ? "Replaying demo…" : "Try a replay"}
            </button>
            <button className="text-button" onClick={copyCapability}>
              {copied ? "Copied" : "Copy preview"}
            </button>
          </div>
          <p className="prototype-note">
            Illustrative contract. No code is generated or executed in this
            preview.
          </p>
        </div>
      ) : null}
      <LiveBrowser agentId={agent.id} visible={visible && tab === "browser"} />
    </section>
  );
}
