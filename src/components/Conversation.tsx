import { RunHistory } from "./RunHistory";
import { Demonstration } from "./Demonstration";
import { RecordingControls } from "./RecordingControls";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { phaseLabel, type Agent } from "../agents";
import { HumanRequest } from "./HumanRequest";
import { MarkdownMessage } from "./MarkdownMessage";
import { Mark } from "./ui";
type Props = {
  agent: Agent;
  model: string;
  enabled: boolean;
  startupError: string | null;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => Promise<void>;
  onOpenLink: (url: string) => Promise<void>;
};
export function Conversation({
  agent,
  model,
  enabled,
  startupError,
  onSend,
  onStop,
  onOpenLink,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const busy = agent.live.status === "running";
  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);
  async function stop() {
    if (!busy || stopping) return;
    setStopping(true);
    setStopError(null);
    try {
      await onStop();
    } catch {
      setStopping(false);
      setStopError("Could not stop the agent. Try again.");
    }
  }
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "instant",
    });
  }, [agent.messages.length, agent.live.tools.length]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || busy || sending || !enabled || agent.live.pending)
      return;
    const text = draft;
    setSending(true);
    try {
      if (await onSend(text.trim()))
        setDraft((current) => (current === text ? "" : current));
    } finally {
      setSending(false);
    }
  }
  return (
    <section
      className="conversation"
      aria-label={`Conversation with ${agent.name}`}
    >
      <header className="conversation-header">
        <h1>{agent.name}</h1>
        <div className="conversation-actions">
          <RecordingControls key={agent.id} chat={agent.live} />
          {agent.messages.length > 0 && (
            <span className="phase-pill">
              <span />
              {stopping ? "Stopping…" : phaseLabel(agent.phase)}
            </span>
          )}
          {busy && (
            <button
              className="stop-agent-button"
              type="button"
              onClick={() => void stop()}
              disabled={stopping}
              aria-label="Stop agent"
              title="Stop the current turn"
            >
              <Square size={11} fill="currentColor" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>
      </header>
      <div className="conversation-scroll" ref={scroll}>
        {!agent.messages.length && (
          <div className="welcome">
            <div className="welcome-mark">
              <Mark />
            </div>
            <h2>What’s the task?</h2>
            <p>A website and an outcome.</p>
          </div>
        )}
        {agent.messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "user-message additional-message"
                : "assistant-message additional-message"
            }
          >
            <div className="message-person">
              <strong>{message.role === "user" ? "You" : "awl"}</strong>
              {message.role === "assistant" && (
                <span>
                  {agent.live.mode === "execution" ? "Capability" : model}
                </span>
              )}
            </div>
            <MarkdownMessage text={message.text} onOpenLink={onOpenLink} />
          </article>
        ))}
        {!!agent.live.tools.length && (
          <details className="live-tool-activity">
            <summary>
              {busy ? "Working" : "Tool activity"} · {agent.live.tools.length}{" "}
              calls
            </summary>
            <ol>
              {agent.live.tools.map((tool) => (
                <li key={tool.id}>
                  <span>{tool.name.replaceAll("_", " ")}</span>
                  <span>{tool.detail ?? tool.state}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
        {busy && (
          <p className="live-agent-status" role="status">
            {agent.live.tools.at(-1)?.state === "running"
              ? `${agent.live.tools.at(-1)!.name.replaceAll("_", " ")}…`
              : agent.live.mode === "execution"
                ? "Executing capability…"
                : "Thinking…"}
          </p>
        )}
        {agent.live.execution && (
          <p className="live-agent-status">
            {agent.live.execution.validation ? "Validation" : "Execution"} ·{" "}
            {Math.min(
              agent.live.execution.step + 1,
              agent.live.execution.total,
            )}
            /{agent.live.execution.total} steps · {agent.live.execution.status}
          </p>
        )}
        {!!agent.live.journal?.length && (
          <RunHistory key={`history-${agent.id}`} events={agent.live.journal} />
        )}
        <Demonstration key={`demonstration-${agent.id}`} chat={agent.live} />
        {agent.live.pending && (
          <HumanRequest
            key={agent.live.pending.id}
            agentId={agent.id}
            request={agent.live.pending}
            capture={agent.live.control?.capture}
            repair={agent.live.mode === "execution"}
          />
        )}
        {(stopError || startupError || agent.live.error) && (
          <p className="live-agent-error" role="alert">
            {stopError || startupError || agent.live.error}
          </p>
        )}
      </div>
      <div className="composer-area">
        <form className="composer" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="message">
            Message your agent
          </label>
          <textarea
            id="message"
            placeholder="What do you want to get done?"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="composer-bottom">
            {busy ? (
              <button
                className="send-button stop-agent-icon"
                type="button"
                aria-label="Stop generating"
                title="Stop the current turn"
                disabled={stopping}
                onClick={() => void stop()}
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                disabled={
                  !draft.trim() || sending || !enabled || !!agent.live.pending
                }
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
