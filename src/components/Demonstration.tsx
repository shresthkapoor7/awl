import { useState } from "react";
import type { AgentChat } from "../../shared/agent";
export function Demonstration({ chat }: { chat: AgentChat }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recording = chat.demonstration;
  const act = async (
    action: "start" | "pause" | "stop" | "remove" | "teach" | "reset",
    stepId?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.awlAgent?.record(chat.id, action, stepId, {});
      setError(result?.error ?? null);
    } catch {
      setError("Could not update recording.");
    } finally {
      setBusy(false);
    }
  };
  if (!recording || recording.mode === "off") return null;
  return (
    <section className="human-request" aria-label="Demonstration">
      <strong>
        {recording.mode === "recording"
          ? "Recording demonstration"
          : "Recorded demonstration"}
      </strong>
      {recording?.mode === "review" &&
        chat.pending?.reason === "demonstration" && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void act("reset")}
          >
            Discard demonstration
          </button>
        )}
      {recording?.notice && <p>{recording.notice}</p>}
      {!!recording?.steps.length && (
        <details>
          <summary>{recording.steps.length} recorded steps</summary>
          <ol className="recorded-steps">
            {recording.steps.map((step) => (
              <li key={step.id}>
                <span>
                  {step.operation} ·{" "}
                  {step.target?.value || step.url || "Private gap"}
                </span>
              </li>
            ))}
          </ol>
          {recording.mode === "review" &&
            chat.pending?.reason === "demonstration" && (
              <button disabled={busy} onClick={() => void act("teach")}>
                Build capability
              </button>
            )}
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
