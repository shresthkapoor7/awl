import { Circle, Pause, Square } from "lucide-react";
import { useState } from "react";
import type { AgentChat } from "../../shared/agent";

export function RecordingControls({ chat }: { chat: AgentChat }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = chat.demonstration?.mode;
  const recording = mode === "recording";
  async function act(action: "start" | "pause" | "stop") {
    setBusy(true);
    setError(null);
    try {
      const result = await window.awlAgent?.record(chat.id, action);
      setError(result?.error ?? null);
    } catch {
      setError("Could not update recording. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="recording-controls">
      <button
        className="stop-agent-button"
        type="button"
        disabled={busy || chat.status === "running" || !window.awlAgent}
        aria-pressed={recording}
        title={
          chat.status === "running"
            ? "Stop the agent before recording"
            : "Record a demonstration"
        }
        onClick={() => void act(recording ? "pause" : "start")}
      >
        {recording ? <Pause size={12} /> : <Circle size={12} />}
        {recording ? "Pause · private" : "Record"}
      </button>
      {(recording || mode === "paused") && (
        <button
          className="stop-agent-button"
          type="button"
          disabled={busy}
          onClick={() => void act("stop")}
        >
          <Square size={12} /> Stop & build
        </button>
      )}
      {error && (
        <span className="recording-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
