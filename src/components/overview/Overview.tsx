import { ArrowUpRight, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Agent } from "../../demo";
import { IconButton } from "../ui";
import { AgentStatus } from "./AgentStatus";
import { createOffice } from "./office-scene";
import "./overview.css";

type Props = { agents: Agent[]; onSelect: (id: string) => void };

export default function Overview({ agents, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const office = useRef<ReturnType<typeof createOffice> | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const current = useRef({ agents, onSelect });
  current.current = { agents, onSelect };
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const needsHelp = agents.filter((agent) => agent.phase === "waiting").length;

  useEffect(() => {
    if (!host.current || failed) return;
    try {
      office.current = createOffice(host.current, current.current.agents, {
        onSelect: (id) => current.current.onSelect(id),
        onFailure: () => setFailed(true),
        onLabels: (positions) =>
          positions.forEach(({ id, x, y, visible }) => {
            const label = labels.current.get(id);
            if (!label) return;
            label.style.left = `${x}px`;
            label.style.top = `${y}px`;
            label.style.visibility = visible ? "visible" : "hidden";
          }),
      });
      setReady(true);
    } catch {
      setFailed(true);
    }
    return () => {
      office.current?.dispose();
      office.current = null;
    };
  }, [failed]);
  useEffect(() => {
    office.current?.updateAgents(agents);
  }, [agents]);

  return (
    <section
      id="overview-view"
      role="tabpanel"
      aria-labelledby="overview-tab"
      className="overview"
    >
      <header className="overview-header">
        <div>
          <h1>Overview</h1>
          <p>
            {agents.length} {agents.length === 1 ? "agent" : "agents"}
            {needsHelp > 0 && (
              <>
                {" "}
                <span>·</span> {needsHelp} {needsHelp === 1 ? "needs" : "need"}{" "}
                you
              </>
            )}
          </p>
        </div>
        {!failed && (
          <div className="office-controls" aria-label="Office camera">
            <IconButton
              label="Zoom out"
              onClick={() => office.current?.zoomBy(1 / 1.2)}
            >
              <Minus size={15} />
            </IconButton>
            <IconButton
              label="Zoom in"
              onClick={() => office.current?.zoomBy(1.2)}
            >
              <Plus size={15} />
            </IconButton>
            <IconButton
              label="Reset office view"
              onClick={() => office.current?.resetCamera()}
            >
              <RotateCcw size={14} />
            </IconButton>
          </div>
        )}
      </header>
      <div className="office-stage" data-ready={ready && !failed}>
        {failed ? (
          <div className="office-fallback" role="status">
            <p>The 3D view isn’t available here.</p>
            <span>Your agents are still available below.</span>
          </div>
        ) : (
          <>
            <div ref={host} className="office-canvas" />
            <div className="station-labels">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  ref={(element) => {
                    if (element) labels.current.set(agent.id, element);
                    else labels.current.delete(agent.id);
                  }}
                  className={`station-label ${agent.phase === "waiting" ? "needs-help" : ""}`}
                  aria-label={`Open ${agent.name} chat`}
                  aria-describedby={`office-status-${agent.id}`}
                  onClick={() => onSelect(agent.id)}
                >
                  <span className="station-label-title">
                    <span>{agent.name}</span>
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </span>
                  <AgentStatus
                    phase={agent.phase}
                    id={`office-status-${agent.id}`}
                  />
                </button>
              ))}
            </div>
            <span className="office-instruction">
              Drag to orbit · Scroll to zoom
            </span>
          </>
        )}
      </div>
      <nav className="overview-agents" aria-label="Office agents">
        {agents.map((agent, index) => (
          <button
            key={agent.id}
            className="overview-agent"
            onClick={() => onSelect(agent.id)}
          >
            <span className="station-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="overview-agent-copy">
              <strong>{agent.name}</strong>
              <AgentStatus phase={agent.phase} />
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </nav>
    </section>
  );
}
