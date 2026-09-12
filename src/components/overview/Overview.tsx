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
  const connectors = useRef(new Map<string, SVGPathElement>());
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
        onLabels: (positions) => {
          // Gathering agents can project close together. Keep their labels
          // readable instead of stacking the completed cards over each other.
          const placed: {
            left: number;
            right: number;
            top: number;
            bottom: number;
          }[] = [];
          positions
            .sort((a, b) => a.y - b.y)
            .forEach(({ id, x, y, visible }) => {
              const label = labels.current.get(id);
              if (!label) return;
              const width = label.offsetWidth;
              const top = y - label.offsetHeight;
              const nearby = placed.filter(
                (rect) => top < rect.bottom + 8 && y + 8 > rect.top,
              );
              const candidates = [
                x - width / 2,
                ...nearby.flatMap((rect) => [
                  rect.left - width - 8,
                  rect.right + 8,
                ]),
              ]
                .filter(
                  (left) =>
                    left >= 8 &&
                    left + width <= (host.current?.clientWidth ?? 0) - 8,
                )
                .sort(
                  (a, b) =>
                    Math.abs(a + width / 2 - x) - Math.abs(b + width / 2 - x),
                );
              const left =
                candidates.find((candidate) =>
                  nearby.every(
                    (rect) =>
                      candidate + width + 7 < rect.left ||
                      candidate > rect.right + 7,
                  ),
                ) ?? x - width / 2;
              label.style.left = `${left + width / 2}px`;
              label.style.top = `${y}px`;
              label.style.visibility = visible ? "visible" : "hidden";
              const connector = connectors.current.get(id);
              if (connector) {
                connector.style.visibility =
                  visible && Math.abs(left + width / 2 - x) > 1
                    ? "visible"
                    : "hidden";
                connector.setAttribute(
                  "d",
                  `M ${x} ${y + 10} L ${x} ${y + 4} L ${left + width / 2} ${y + 4} L ${left + width / 2} ${y}`,
                );
              }
              if (visible)
                placed.push({ left, right: left + width, top, bottom: y });
            });
        },
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
              <svg className="station-connectors" aria-hidden="true">
                {agents.map((agent) => (
                  <path
                    key={agent.id}
                    ref={(element) => {
                      if (element) connectors.current.set(agent.id, element);
                      else connectors.current.delete(agent.id);
                    }}
                  />
                ))}
              </svg>
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
