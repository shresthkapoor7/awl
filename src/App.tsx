import {
  Check,
  Boxes,
  MessageSquare,
  ChevronRight,
  Command,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Workflow,
  Code2,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
} from "react";
import {
  blankAgent,
  fromChat,
  newestFirst,
  phaseLabel,
  type Agent,
} from "./agents";
import { Capabilities } from "./components/Capabilities";
import { ResizeHandle } from "./components/ResizeHandle";
import { BrowserPanel } from "./components/BrowserPanel";
import { Conversation } from "./components/Conversation";
import { DeleteButton } from "./components/DeleteButton";
import { IconButton, Mark, StatusDot } from "./components/ui";
import type { AgentChat } from "../shared/agent";

const Overview = lazy(() => import("./components/overview/Overview"));
const workspaceViews = ["chat", "overview", "capabilities"] as const;

export function App() {
  const isMac = /Mac/.test(navigator.platform);
  const [view, setView] = useState<(typeof workspaceViews)[number]>("chat");
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [fallback] = useState(blankAgent);
  const [model, setModel] = useState("gpt-5.6-terra");
  const [{ agents, selectedId }, setWorkspace] = useState<{
    agents: Agent[];
    selectedId: string | null;
  }>(() => ({
    agents: [],
    selectedId: sessionStorage.getItem("awl-selected-chat"),
  }));
  function setAgents(update: SetStateAction<Agent[]>) {
    setWorkspace((current) => ({
      ...current,
      agents: typeof update === "function" ? update(current.agents) : update,
    }));
  }
  function setSelectedId(update: SetStateAction<string | null>) {
    setWorkspace((current) => ({
      ...current,
      selectedId:
        typeof update === "function" ? update(current.selectedId) : update,
    }));
  }
  const deletedIds = useRef(new Set<string>());
  const creatingBlank = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [browserOpen, setBrowserOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
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
  const agent =
    agents.find((item) => item.id === selectedId) ?? agents[0] ?? fallback;
  useEffect(() => {
    if (selectedId) sessionStorage.setItem("awl-selected-chat", selectedId);
    else sessionStorage.removeItem("awl-selected-chat");
  }, [selectedId]);
  useEffect(() => {
    if (!ready || agents.length || startupError || creatingBlank.current)
      return;
    creatingBlank.current = true;
    void newAgent().finally(() => {
      creatingBlank.current = false;
    });
  }, [ready, agents.length, startupError]);

  useEffect(() => {
    const bridge = window.awlAgent;
    if (!bridge) {
      setAgents([fallback]);
      setSelectedId(fallback.id);
      setReady(true);
      return;
    }
    let active = true;
    const received = new Set<string>();
    function receive(chat: AgentChat) {
      if (deletedIds.current.has(chat.id)) return;
      received.add(chat.id);
      if (!active) return;
      setAgents((current) =>
        newestFirst(
          current.some((item) => item.id === chat.id)
            ? current.map((item) =>
                item.id === chat.id ? fromChat(chat) : item,
              )
            : [fromChat(chat), ...current],
        ),
      );
    }
    const unsubscribe = bridge.subscribe(receive);
    void bridge
      .state()
      .then(async (state) => {
        if (!active) return;
        setModel(state.model);
        state.chats.filter((chat) => !received.has(chat.id)).forEach(receive);
        if (!state.chats.length && !received.size) {
          const result = await bridge.create(fallback.id);
          if (!active) return;
          if (result.chat) receive(result.chat);
          else setStartupError(result.error ?? "Could not create a chat.");
        }
        setSelectedId((current) =>
          state.chats.some((chat) => chat.id === current)
            ? current
            : (state.chats[0]?.id ?? fallback.id),
        );
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setStartupError("Could not load the workspace.");
          setReady(true);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [fallback]);
  function selectAgent(id: string) {
    setView("chat");
    setMobileView("chat");
    setSelectedId(id);
  }
  async function newAgent() {
    setCreateError(null);
    const next = blankAgent();
    if (window.awlAgent) {
      const result: { chat?: AgentChat; error?: string } = await window.awlAgent
        .create(next.id)
        .catch(() => ({ error: "Could not create a chat." }));
      if (!result.chat) {
        setCreateError(result.error ?? "Could not create a chat.");
        return;
      }
      setAgents((current) =>
        newestFirst([
          fromChat(result.chat!),
          ...current.filter((item) => item.id !== next.id),
        ]),
      );
    } else setAgents((current) => newestFirst([next, ...current]));
    setStartupError(null);
    setSearch("");
    selectAgent(next.id);
  }
  async function send(text: string): Promise<boolean> {
    const id = agent.id;
    const result = window.awlAgent
      ? await window.awlAgent
          .send(id, text)
          .catch(() => ({ error: "Could not reach the local agent." }))
      : { error: "Open awl in Electron to use the agent." };
    if (result.error) {
      setAgents((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, live: { ...item.live, error: result.error! } }
            : item,
        ),
      );
      return false;
    }
    return true;
  }
  async function deleteSession(id: string) {
    const result = window.awlAgent
      ? await window.awlAgent
          .deleteSession(id)
          .catch(() => ({ error: "Could not delete this session." }))
      : {};
    if (result.error) {
      setCreateError(result.error);
      return;
    }
    deletedIds.current.add(id);
    setWorkspace((current) => {
      const remaining = current.agents.filter((item) => item.id !== id);
      return {
        agents: remaining,
        selectedId: remaining.some((item) => item.id === current.selectedId)
          ? current.selectedId
          : (remaining[0]?.id ?? null),
      };
    });
    setCreateError(null);
  }
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    function togglePanel(side: "left" | "right") {
      if (side === "left") setSidebarOpen((open) => !open);
      else setBrowserOpen((open) => !open);
    }
    const unsubscribe = window.awlWorkspace?.onTogglePanel(togglePanel);
    function shortcut(event: KeyboardEvent) {
      if (
        !window.awlWorkspace &&
        (isMac ? event.metaKey : event.ctrlKey) &&
        !event.shiftKey &&
        (event.code === "KeyB" || event.key.toLowerCase() === "b")
      ) {
        event.preventDefault();
        if (!event.repeat) togglePanel(event.altKey ? "right" : "left");
        return;
      }
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
    return () => {
      window.removeEventListener("keydown", shortcut);
      unsubscribe?.();
    };
  }, [isMac]);

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
            title={`${sidebarOpen ? "Hide sidebar" : "Show sidebar"} (${isMac ? "⌘B" : "Ctrl+B"})`}
            aria-keyshortcuts={isMac ? "Meta+B" : "Control+B"}
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
          <span>
            {view === "chat"
              ? agent.name
              : view === "overview"
                ? "Overview"
                : "Capabilities"}
          </span>
        </div>
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label="Workspace views"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const index = workspaceViews.indexOf(view);
            const next =
              workspaceViews[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? workspaceViews.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        workspaceViews.length) %
                      workspaceViews.length
              ];
            setView(next);
            document.getElementById(`${next}-tab`)?.focus();
          }}
        >
          <button
            id="chat-tab"
            role="tab"
            aria-selected={view === "chat"}
            aria-controls="chat-view"
            tabIndex={view === "chat" ? 0 : -1}
            onClick={() => setView("chat")}
          >
            <MessageSquare size={14} />
            Chat
          </button>
          <button
            id="overview-tab"
            role="tab"
            aria-selected={view === "overview"}
            aria-controls="overview-view"
            tabIndex={view === "overview" ? 0 : -1}
            onClick={() => setView("overview")}
          >
            <Boxes size={15} />
            Overview
          </button>
          <button
            id="capabilities-tab"
            role="tab"
            aria-selected={view === "capabilities"}
            aria-controls="capabilities-view"
            tabIndex={view === "capabilities" ? 0 : -1}
            onClick={() => setView("capabilities")}
          >
            <Code2 size={15} />
            Capabilities
          </button>
        </div>
        <IconButton
          style={{ visibility: view !== "chat" ? "hidden" : "visible" }}
          label={browserOpen ? "Hide browser" : "Show browser"}
          title={`${browserOpen ? "Hide browser" : "Show browser"} (${isMac ? "⌘⌥B" : "Ctrl+Alt+B"})`}
          aria-keyshortcuts={isMac ? "Meta+Alt+B" : "Control+Alt+B"}
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
          <button
            className="new-agent"
            onClick={() => void newAgent()}
            disabled={!ready}
          >
            <Plus size={17} />
            <span>New agent</span>
          </button>
          {createError && (
            <p className="create-agent-error" role="alert">
              {createError}
            </p>
          )}
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
                item.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((item) => (
                <div className="agent-row" key={item.id}>
                  <button
                    className={`agent-item ${item.id === selectedId ? "selected" : ""}`}
                    aria-current={item.id === selectedId ? "page" : undefined}
                    onClick={() => selectAgent(item.id)}
                  >
                    <span className="agent-glyph">
                      <Workflow size={17} />
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
                        {item.live && item.phase === "replaying"
                          ? "Working"
                          : phaseLabel(item.phase)}
                      </span>
                    </span>
                    {item.phase === "finished" && (
                      <Check className="agent-check" size={12} />
                    )}
                  </button>
                  <DeleteButton
                    name={`session ${item.name}`}
                    onDelete={() => deleteSession(item.id)}
                  />
                </div>
              ))}
            {!agents.some((item) =>
              item.name.toLowerCase().includes(search.toLowerCase()),
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
        id="chat-view"
        role="tabpanel"
        aria-labelledby="chat-tab"
        hidden={view !== "chat"}
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
            Browser
          </button>
        </div>
        <Conversation
          key={`conversation-${agent.id}`}
          agent={agent}
          onSend={send}
          onOpenLink={async (url) => {
            setBrowserOpen(true);
            setMobileView("browser");
            if (!window.awlBrowser)
              throw new Error("Open awl in Electron to browse links.");
            const result = await window.awlBrowser.command({
              action: "navigate",
              agentId: agent.id,
              url,
            });
            if (result.error) throw new Error(result.error);
          }}
          enabled={ready && !startupError}
          startupError={startupError}
          model={model}
          onStop={async () => {
            if (!window.awlAgent) throw new Error("Agent unavailable");
            await window.awlAgent.stop(agent.id);
          }}
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
          {ready && (
            <BrowserPanel
              key={`browser-${agent.id}`}
              agent={agent}
              visible={
                view === "chat" &&
                browserOpen &&
                (windowWidth > 980 || mobileView === "browser")
              }
            />
          )}
        </div>
      </main>
      {view === "overview" && (
        <Suspense
          fallback={
            <div className="overview-loading" role="status">
              Opening overview…
            </div>
          }
        >
          <Overview
            agents={agents}
            onSelect={(id) => {
              selectAgent(id);
              requestAnimationFrame(() =>
                document.getElementById("message")?.focus(),
              );
            }}
          />
        </Suspense>
      )}
      {view === "capabilities" && (
        <Capabilities
          onLaunch={(chat) => {
            setAgents((current) =>
              current.some((item) => item.id === chat.id)
                ? current
                : newestFirst([fromChat(chat), ...current]),
            );
            selectAgent(chat.id);
            setBrowserOpen(true);
          }}
        />
      )}
    </div>
  );
}
