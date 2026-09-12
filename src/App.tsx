import {
  Check,
  ChevronRight,
  Command,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { initialAgents, phaseLabel, type Agent } from "./demo";
import { ResizeHandle } from "./components/ResizeHandle";
import { BrowserPanel } from "./components/BrowserPanel";
import { Conversation } from "./components/Conversation";
import { IconButton, Mark, StatusDot } from "./components/ui";

export function App() {
  const [agents, setAgents] = useState<Agent[]>(() =>
    structuredClone(initialAgents),
  );
  const [selectedId, setSelectedId] = useState("onboarding");
  const [tab, setTab] = useState<"browser" | "capability">("browser");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [browserOpen, setBrowserOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [browserWidth, setBrowserWidth] = useState(580);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const sidebarMax = Math.min(320, Math.max(180, windowWidth - 680));
  const leftWidth = Math.min(sidebarWidth, sidebarMax);
  const browserMax = Math.max(
    340,
    windowWidth - (sidebarOpen ? leftWidth : 0) - 320,
  );
  const rightWidth = Math.min(browserWidth, browserMax);
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [mobileView, setMobileView] = useState<"chat" | "browser">("chat");
  const searchInput = useRef<HTMLInputElement>(null);
  const agent = agents.find((item) => item.id === selectedId)!;

  function updateAgent(patch: Partial<Agent>, id = selectedId) {
    setAgents((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function newAgent() {
    const id = crypto.randomUUID();
    setAgents((current) => [
      ...current,
      {
        id,
        name: "New agent",
        description: "Waiting for a goal",
        kind: "onboarding",
        phase: "new",
        verified: false,
        messages: [],
      },
    ]);
    setSelectedId(id);
    setSearch("");
    setTab("browser");
    setMobileView("chat");
  }
  function selectAgent(id: string) {
    setSelectedId(id);
    setTab("browser");
    setMobileView("chat");
  }
  function takeControl() {
    updateAgent({ phase: "human" });
    setTab("browser");
    setMobileView("browser");
    setBrowserOpen(true);
  }
  function resume() {
    if (agent.verified && agent.phase === "human")
      updateAgent({ phase: "ready" });
  }
  function replay() {
    if (["ready", "finished"].includes(agent.phase)) {
      updateAgent({ phase: "replaying" });
    }
  }
  function reset() {
    updateAgent({
      phase: agent.kind === "statement" ? "finished" : "waiting",
      verified: agent.kind === "statement",
      messages: [],
    });
    setTab("browser");
  }
  function send(text: string) {
    if (agent.phase === "new") {
      updateAgent({
        name: text.length > 30 ? `${text.slice(0, 29)}…` : text,
        description: "Onboarding demo session",
        phase: "waiting",
        messages: [
          { id: crypto.randomUUID(), role: "user", text },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Sample workflow loaded. Take control to try the handoff.",
          },
        ],
      });
    } else {
      updateAgent({
        messages: [
          ...agent.messages,
          { id: crypto.randomUUID(), role: "user", text },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Noted for this demo. Live responses aren’t connected yet.",
          },
        ],
      });
    }
  }
  useEffect(() => {
    const running = agents.filter((item) => item.phase === "replaying");
    if (!running.length) return;
    const timer = window.setTimeout(() => {
      setAgents((current) =>
        current.map((item) =>
          running.some((run) => run.id === item.id) &&
          item.phase === "replaying"
            ? { ...item, phase: "finished" }
            : item,
        ),
      );
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [agents]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSidebarOpen(true);
        setSearchOpen(true);
        searchInput.current?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSearch("");
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  return (
    <div
      className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}
      style={
        {
          "--sidebar-width": `${leftWidth}px`,
          "--browser-width": `${rightWidth}px`,
        } as CSSProperties
      }
    >
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="window-clearance" />
          <IconButton
            label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </IconButton>
        </div>
        <div className="titlebar-center">
          <span>Workspace</span>
          <ChevronRight size={12} />
          <span>{agent.name}</span>
        </div>
        <IconButton
          label={browserOpen ? "Hide browser" : "Show browser"}
          onClick={() => {
            setBrowserOpen(!browserOpen);
            setMobileView(browserOpen ? "chat" : "browser");
          }}
        >
          {browserOpen ? (
            <PanelRightClose size={16} />
          ) : (
            <PanelRightOpen size={16} />
          )}
        </IconButton>
      </header>
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="brand-row">
            <div className="brand">
              <Mark />
              <span>
                awl<span className="brand-period">.</span>
              </span>
            </div>
          </div>
          <button className="new-agent" onClick={newAgent}>
            <Plus size={17} />
            <span>New agent</span>
          </button>
          <button
            className="search-trigger"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={15} />
            <span>Find a session</span>
            <kbd>
              <Command size={10} /> K
            </kbd>
          </button>
          {searchOpen && (
            <input
              className="session-search"
              aria-label="Search sessions"
              placeholder="Search sessions…"
              ref={searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          <div className="sidebar-section-label">
            <span>YOUR AGENTS</span>
            <span>{agents.length.toString().padStart(2, "0")}</span>
          </div>
          <nav className="agent-list" aria-label="Agents">
            {agents
              .filter((item) =>
                `${item.name} ${item.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item) => (
                <button
                  key={item.id}
                  className={`agent-item ${item.id === selectedId ? "selected" : ""}`}
                  aria-current={item.id === selectedId ? "page" : undefined}
                  onClick={() => selectAgent(item.id)}
                >
                  <span className="agent-glyph">
                    {item.kind === "statement" ? (
                      <FileText size={16} />
                    ) : (
                      <Workflow size={17} />
                    )}
                  </span>
                  <span className="agent-copy">
                    <strong>{item.name}</strong>
                    <span>
                      <StatusDot
                        active={
                          item.phase === "waiting" ||
                          item.phase === "human" ||
                          item.phase === "replaying"
                        }
                      />
                      {phaseLabel(item.phase)}
                    </span>
                  </span>
                  {item.phase === "finished" && (
                    <Check className="agent-check" size={12} />
                  )}
                </button>
              ))}
            {!agents.some((item) =>
              `${item.name} ${item.description}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ) && <p className="no-results">No sessions found.</p>}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-workspace">
              <span className="workspace-avatar">a</span>
              <div>
                <strong>Personal workspace</strong>
                <span>
                  <StatusDot />
                  On this computer
                </span>
              </div>
            </div>
          </div>
          <ResizeHandle
            label="Resize agent sidebar"
            value={leftWidth}
            min={180}
            max={sidebarMax}
            onChange={setSidebarWidth}
          />
        </aside>
      )}
      <main
        className={`workspace mobile-${mobileView} ${browserOpen ? "" : "browser-collapsed"}`}
      >
        <div className="mobile-view-switch">
          <button
            aria-pressed={mobileView === "chat"}
            onClick={() => setMobileView("chat")}
          >
            Conversation
          </button>
          <button
            aria-pressed={mobileView === "browser"}
            onClick={() => {
              setMobileView("browser");
              setBrowserOpen(true);
            }}
          >
            Browser & capability
          </button>
        </div>
        <Conversation
          key={`conversation-${agent.id}`}
          agent={agent}
          onSend={send}
          onTakeControl={takeControl}
          onResume={resume}
          onCapability={() => {
            setTab("capability");
            setMobileView("browser");
            setBrowserOpen(true);
          }}
          onReplay={replay}
        />
        <div className="browser-dock" hidden={!browserOpen}>
          <ResizeHandle
            label="Resize browser panel"
            value={rightWidth}
            min={340}
            max={browserMax}
            onChange={setBrowserWidth}
            reversed
          />
          <BrowserPanel
            key={`browser-${agent.id}`}
            agent={agent}
            tab={tab}
            setTab={setTab}
            onTakeControl={takeControl}
            onVerify={(verified) => updateAgent({ verified })}
            onResume={resume}
            onReplay={replay}
            onReset={reset}
          />
        </div>
      </main>
    </div>
  );
}
