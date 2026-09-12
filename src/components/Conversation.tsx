import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { phaseLabel, type Agent } from "../agents";
import { MarkdownMessage } from "./MarkdownMessage";
import { Mark } from "./ui";
type Props = {
  agent: Agent;
  model: string;
  enabled: boolean;
  startupError: string | null;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onOpenLink: (url: string) => void;
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
  const scroll = useRef<HTMLDivElement>(null);
  const busy = agent.live.status === "running";
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "instant",
    });
  }, [agent.messages.length, agent.live.tools.length]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || busy || sending || !enabled) return;
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
        {agent.messages.length > 0 && (
          <span className="phase-pill">
            <span />
            {phaseLabel(agent.phase)}
          </span>
        )}
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
              {message.role === "assistant" && <span>{model}</span>}
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
              : "Thinking…"}
          </p>
        )}
        {(startupError || agent.live.error) && (
          <p className="live-agent-error" role="alert">
            {startupError || agent.live.error}
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
                className="send-button"
                type="button"
                aria-label="Stop agent"
                onClick={onStop}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                disabled={!draft.trim() || sending || !enabled}
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
