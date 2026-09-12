import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { initialAgents, phaseLabel, type Agent } from "./demo";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"chat" | "browser">("chat");
  const dialog = useRef<HTMLDialogElement>(null);
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
            text: "This preview uses the sample onboarding workflow. You can try taking control, confirming the details, and replaying the result.",
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
            text: "Your direction is noted for this demo session. Use the browser and handoff controls to explore the workflow; live AI responses will come later.",
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
    if (helpOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [helpOpen]);
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
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
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
        <span className="preview-badge">Interface preview</span>
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
            <span className="version">0.1</span>
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
            <div className="sidebar-note">
              <span className="note-line" />
              <p>
                A little less repetition.
                <br />A little more possibility.
              </p>
            </div>
            <button className="help-button" onClick={() => setHelpOpen(true)}>
              <CircleHelp size={16} />
              <span>About this preview</span>
              <ChevronRight size={13} />
            </button>
            <div className="local-workspace">
              <span className="workspace-avatar">a</span>
              <div>
                <strong>Personal workspace</strong>
                <span>
                  <StatusDot />
                  On this computer
                </span>
              </div>
              <ChevronDown size={13} />
            </div>
          </div>
        </aside>
      )}
      <main className={`workspace mobile-${mobileView}`}>
        <div className="mobile-view-switch">
          <button
            aria-pressed={mobileView === "chat"}
            onClick={() => setMobileView("chat")}
          >
            Conversation
          </button>
          <button
            aria-pressed={mobileView === "browser"}
            onClick={() => setMobileView("browser")}
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
          }}
          onReplay={replay}
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
      </main>
      <dialog
        ref={dialog}
        className="help-dialog"
        onCancel={() => setHelpOpen(false)}
        onClose={() => setHelpOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setHelpOpen(false);
        }}
      >
        <div className="dialog-heading">
          <BookOpen size={20} />
          <IconButton
            label="Close preview guide"
            onClick={() => setHelpOpen(false)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <span className="eyebrow">A FIRST LOOK AT AWL</span>
        <h2>The workflow is the interface.</h2>
        <p>
          This is an interactive, local UI prototype. The member portal, agent
          responses, and saved capability are sample data.
        </p>
        <ol>
          <li>Take control of the paused browser.</li>
          <li>Confirm the fictional member’s details.</li>
          <li>Hand it back and inspect the capability.</li>
          <li>Try the simulated replay.</li>
        </ol>
        <p className="dialog-note">
          No websites are visited, no API calls are made, and nothing is
          submitted. Changes reset when the app closes or reloads.
        </p>
        <button className="primary-button" onClick={() => setHelpOpen(false)}>
          Back to the workspace
        </button>
      </dialog>
    </div>
  );
}
