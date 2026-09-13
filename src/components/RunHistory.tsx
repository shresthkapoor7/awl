import { useEffect, useState } from "react";
import type { RunEvent } from "../../shared/recording";
export function RunHistory({ events }: { events: RunEvent[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setIndex((current) => {
          if (current >= events.length - 1) {
            setPlaying(false);
            return current;
          }
          return current + 1;
        }),
      900,
    );
    return () => clearInterval(timer);
  }, [playing, events.length]);
  const selected = events[Math.min(index, events.length - 1)];
  if (!selected) return null;
  return (
    <details
      className="human-request"
      onToggle={(event) => {
        if (!event.currentTarget.open) setPlaying(false);
      }}
    >
      <summary>Run history · {events.length} events</summary>
      <div className="request-choices">
        <button
          onClick={() => {
            if (index >= events.length - 1) setIndex(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause history" : "Play history"}
        </button>
        <span>
          {index + 1}/{events.length}
        </span>
      </div>
      <input
        aria-label="History position"
        type="range"
        min={0}
        max={events.length - 1}
        value={index}
        onChange={(event) => {
          setPlaying(false);
          setIndex(Number(event.target.value));
        }}
      />
      <p>
        {new Date(selected.at).toLocaleTimeString()} · {selected.actor} ·{" "}
        {selected.label}
      </p>
      {selected.image ? (
        <img
          className="history-capture"
          src={selected.image}
          alt="Previously captured browser state"
        />
      ) : (
        <p className="private-notice">
          {selected.kind === "gap" || selected.kind === "handoff"
            ? "Private interval · no capture"
            : "No image retained for this event"}
        </p>
      )}
    </details>
  );
}
