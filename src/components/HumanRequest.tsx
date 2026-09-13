import { useState } from "react";
import type { PendingQuestion } from "../../shared/agent";
export function HumanRequest({
  agentId,
  request,
  capture,
  repair,
}: {
  agentId: string;
  request: PendingQuestion;
  capture?: string;
  repair?: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="human-request"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          const result = await window.awlAgent?.resume(
            agentId,
            request.id,
            answer,
          );
          if (!result) throw new Error("Open awl in Electron to resume.");
          if (result.error) setError(result.error);
        } catch {
          setError("Could not resume. Check the page and try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>Needs you</strong>
      <p>{request.question}</p>
      <p className="private-notice">
        {capture === "recording"
          ? "Recording your demonstration"
          : "Private control · observation paused"}
      </p>
      {request.reason !== "authentication" && (
        <>
          {!!request.choices.length && (
            <div className="request-choices">
              {request.choices.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  aria-pressed={answer === choice}
                  onClick={() => setAnswer(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
          <input
            aria-label="Answer awl"
            placeholder="Answer or describe what changed…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={4000}
          />
        </>
      )}
      <button
        className="primary-button"
        disabled={
          busy || (request.reason !== "authentication" && !answer.trim())
        }
      >
        {busy ? "Checking…" : "Resume"}
      </button>
      {repair && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await window.awlAgent?.repair(agentId);
              setError(result?.error ?? null);
            } catch {
              setError("Could not enter repair.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Repair with awl
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
