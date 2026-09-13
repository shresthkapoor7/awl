import { ChevronLeft, ChevronRight, History, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { RunEvent } from "../../shared/recording";
export function RunHistory({ events }: { events: RunEvent[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const position = Math.min(index, Math.max(0, events.length - 1));
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setIndex((current) => {
          if (current >= events.length - 1) {
            setPlaying(false);
            return Math.max(0, events.length - 1);
          }
          return current + 1;
        }),
      900,
    );
    return () => clearInterval(timer);
  }, [playing, events.length]);
  const selected = events[position];
  if (!selected) return null;
  function seek(next: number) {
    setPlaying(false);
    setIndex(next);
  }
  return (
    <details
      className="run-history"
      onToggle={(event) => {
        if (!event.currentTarget.open) setPlaying(false);
      }}
    >
      <summary>
        <History size={15} />
        <span>Run history</span>
        <span className="history-count">{events.length} events</span>
        <ChevronRight size={14} className="history-chevron" />
      </summary>
      <div className="history-body">
        <div className="history-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous event"
            disabled={position === 0}
            onClick={() => seek(position - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={playing ? "Pause history" : "Play history"}
            title="Play recorded history"
            onClick={() => {
              if (position >= events.length - 1) setIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next event"
            disabled={position === events.length - 1}
            onClick={() => seek(position + 1)}
          >
            <ChevronRight size={15} />
          </button>
          <input
            aria-label="History position"
            aria-valuetext={`Event ${position + 1}: ${selected.label}`}
            type="range"
            min={0}
            max={events.length - 1}
            value={position}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="history-position">
            {position + 1} / {events.length}
          </span>
        </div>
        <div className="history-event">
          <div className="history-meta">
            <span>{selected.actor}</span>
            <time dateTime={selected.at}>
              {new Date(selected.at).toLocaleTimeString()}
            </time>
          </div>
          <p>{selected.label}</p>
        </div>
        {selected.evidence && (
          <details className="history-evidence">
            <summary>
              Failure snapshot · {selected.evidence.frames.length} frames
            </summary>
            <pre className="capability-code">
              {JSON.stringify(selected.evidence, null, 2)}
            </pre>
          </details>
        )}
        {selected.image ? (
          <img
            className="history-capture"
            src={selected.image}
            alt="Previously captured browser state"
          />
        ) : (
          (selected.kind === "gap" || selected.kind === "handoff") && (
            <p className="private-notice">Private interval · no capture</p>
          )
        )}
      </div>
    </details>
  );
}
