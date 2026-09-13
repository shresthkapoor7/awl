import { useState } from "react";
import type { AgentChat } from "../../shared/agent";
export function Demonstration({ chat }: { chat: AgentChat }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const recording = chat.demonstration;
  const act = async (
    action: "start" | "pause" | "stop" | "remove" | "teach" | "reset",
    stepId?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.awlAgent?.record(
        chat.id,
        action,
        stepId,
        parameters,
      );
      setError(result?.error ?? null);
    } catch {
      setError("Could not update recording.");
    } finally {
      setBusy(false);
    }
  };
  if (!chat.pending && !recording) return null;
  return (
    <section className="human-request" aria-label="Demonstration">
      <div className="request-choices">
        <strong>
          {recording?.mode === "recording"
            ? "● Recording demonstration"
            : "Teach awl"}
        </strong>
        {recording?.mode === "recording" ? (
          <button disabled={busy} onClick={() => void act("pause")}>
            Pause · private
          </button>
        ) : (
          <button
            disabled={busy || chat.status === "running"}
            onClick={() => void act("start")}
          >
            Record
          </button>
        )}
        {recording &&
          recording.mode !== "off" &&
          recording.mode !== "review" && (
            <button disabled={busy} onClick={() => void act("stop")}>
              Stop & review
            </button>
          )}
      </div>
      {recording?.mode === "review" && (
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
        <details open={recording.mode === "review"}>
          <summary>{recording.steps.length} recorded steps</summary>
          <ol className="recorded-steps">
            {recording.steps.map((step) => (
              <li key={step.id}>
                <span>
                  {step.operation} ·{" "}
                  {step.target?.value || step.url || "Private gap"}
                </span>
                {recording.mode === "review" && (
                  <>
                    {["fill", "select"].includes(step.operation) && (
                      <input
                        aria-label={`Parameter for ${step.target?.value}`}
                        placeholder="Parameter name, e.g. query"
                        value={parameters[step.id] ?? ""}
                        onChange={(e) =>
                          setParameters({
                            ...parameters,
                            [step.id]: e.target.value,
                          })
                        }
                      />
                    )}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void act("remove", step.id)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {recording.mode === "review" && (
            <button disabled={busy} onClick={() => void act("teach")}>
              Use reviewed demonstration
            </button>
          )}
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
