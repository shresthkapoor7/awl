import { Globe2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Agent } from "../agents";
import { LiveBrowser } from "./LiveBrowser";
import { IconButton } from "./ui";
export function BrowserPanel({
  agent,
  visible,
}: {
  agent: Agent;
  visible: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);
  useEffect(() => {
    const exit = () => setExpanded(false);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exit();
    };
    window.addEventListener("keydown", keydown);
    const unsubscribe = window.awlBrowser?.onExitFullscreen(exit);
    return () => {
      window.removeEventListener("keydown", keydown);
      unsubscribe?.();
    };
  }, []);
  return (
    <section
      className={`browser-panel ${expanded ? "browser-fullscreen" : ""}`}
      aria-label="Session workspace"
    >
      <header className="panel-header">
        <span className="browser-panel-title">
          <Globe2 size={15} />
          Browser
        </span>
        {!agent.live.pending && (
          <button
            className="text-button"
            onClick={() => void window.awlAgent?.takeover(agent.id)}
          >
            Take control
          </button>
        )}
        <IconButton
          label={
            expanded ? "Exit browser fullscreen" : "Enter browser fullscreen"
          }
          aria-pressed={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </IconButton>
      </header>
      <LiveBrowser
        agentId={agent.id}
        visible={visible}
        working={agent.live.status === "running"}
      />
    </section>
  );
}
