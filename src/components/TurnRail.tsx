import { useEffect, useState, type RefObject } from "react";
import type { AgentMessage } from "../../shared/agent";

export function TurnRail({
  messages,
  scroll,
  onJump,
}: {
  messages: AgentMessage[];
  scroll: RefObject<HTMLDivElement | null>;
  onJump: () => void;
}) {
  const turns = messages.filter((message) => message.role === "user");
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const update = () => {
      const top = container.getBoundingClientRect().top + 60;
      const articles = [
        ...container.querySelectorAll<HTMLElement>("[data-turn]"),
      ];
      const current = articles
        .filter((article) => article.getBoundingClientRect().top <= top)
        .at(-1);
      setActive(current?.dataset.turn ?? articles[0]?.dataset.turn ?? null);
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [messages.length, scroll]);
  if (turns.length < 2) return null;
  const hovered = turns.find((message) => message.id === preview);
  const next = hovered ? messages[messages.indexOf(hovered) + 1] : undefined;
  function jump(id: string) {
    const container = scroll.current;
    const target = [
      ...(container?.querySelectorAll<HTMLElement>("[data-turn]") ?? []),
    ].find((article) => article.dataset.turn === id);
    if (!container || !target) return;
    onJump();
    container.scrollTo({
      top:
        container.scrollTop +
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        20,
      behavior: "instant",
    });
    target.focus({ preventScroll: true });
    setActive(id);
    setPreview(null);
  }
  return (
    <nav
      className="turn-rail"
      aria-label="Jump to a chat turn"
      onMouseLeave={() => setPreview(null)}
    >
      <div className="turn-markers">
        {turns.map((turn, index) => (
          <button
            key={turn.id}
            type="button"
            aria-label={`Turn ${index + 1}: ${turn.text.slice(0, 100)}`}
            aria-current={active === turn.id ? "location" : undefined}
            onMouseEnter={() => setPreview(turn.id)}
            onFocus={() => setPreview(turn.id)}
            onBlur={() => setPreview(null)}
            onClick={() => jump(turn.id)}
            onKeyDown={(event) => {
              const offset =
                event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!offset) return;
              event.preventDefault();
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll("button");
              buttons?.[
                Math.max(0, Math.min(turns.length - 1, index + offset))
              ]?.focus();
            }}
          >
            <span />
          </button>
        ))}
      </div>
      {hovered && (
        <div className="turn-preview" aria-hidden="true">
          <strong>{hovered.text}</strong>
          {next?.role === "assistant" && <p>{next.text}</p>}
        </div>
      )}
    </nav>
  );
}
