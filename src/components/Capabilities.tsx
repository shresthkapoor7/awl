import { Code2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SavedCapability } from "../../shared/agent";
import "./capabilities.css";
import { DeleteButton } from "./DeleteButton";
export function Capabilities({
  onLaunch,
}: {
  onLaunch: (chat: import("../../shared/agent").AgentChat) => void;
}) {
  const [drafts, setDrafts] = useState<SavedCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function remove(draft: SavedCapability) {
    setDeleteError(null);
    const result = await window.awlAgent
      ?.deleteCapability({
        id: draft.id,
        sourceChatId: draft.sourceChatId,
        version: draft.version,
      })
      .catch(() => ({ error: "Could not delete this capability." }));
    if (!result || result.error) {
      setDeleteError(
        result?.error ?? "Open awl in Electron to delete capabilities.",
      );
      return;
    }
    setDrafts((current) =>
      current.filter(
        (item) =>
          item.id !== draft.id || item.sourceChatId !== draft.sourceChatId,
      ),
    );
  }
  useEffect(() => {
    let active = true;
    if (!window.awlAgent) {
      setLoading(false);
      return;
    }
    void window.awlAgent
      .capabilities()
      .then((result) => {
        if (active) {
          setDrafts(result.drafts);
          setError(result.error ?? null);
        }
      })
      .catch(() => {
        if (active) setError("Could not read saved capabilities.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section
      id="capabilities-view"
      role="tabpanel"
      aria-labelledby="capabilities-tab"
      className="capabilities-library"
    >
      <div className="capabilities-content">
        <header className="capabilities-heading">
          <h1>Capabilities</h1>
        </header>
        {deleteError && (
          <p className="capabilities-note" role="alert">
            {deleteError}
          </p>
        )}
        {loading ? (
          <p className="capabilities-note" role="status">
            Loading…
          </p>
        ) : error ? (
          <p className="capabilities-note" role="alert">
            {error}
          </p>
        ) : !drafts.length ? (
          <p className="capabilities-note">No saved capabilities yet.</p>
        ) : (
          <>
            <div className="capabilities-list">
              {drafts.map((draft) => (
                <article
                  className="capability-entry"
                  key={`${draft.sourceChatId}:${draft.id}`}
                >
                  <div className="capability-entry-heading">
                    <Code2 size={19} />
                    <h2>{draft.name}</h2>
                    <span>
                      v{draft.version} · {draft.validation ?? "draft"}
                    </span>
                    <DeleteButton
                      name={`capability ${draft.name} (all versions)`}
                      onDelete={() => remove(draft)}
                    />
                  </div>
                  <p>{draft.description}</p>
                  <CapabilityLaunch draft={draft} onLaunch={onLaunch} />
                  <details className="capability-contract">
                    <summary>View draft</summary>
                    <pre>{draft.contract}</pre>
                  </details>
                </article>
              ))}
            </div>
            <p className="capabilities-note">
              Validate with two different input sets to unlock Run.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function CapabilityLaunch({
  draft,
  onLaunch,
}: {
  draft: SavedCapability;
  onLaunch: (chat: import("../../shared/agent").AgentChat) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields: { name: string; type: string; description: string }[] =
    JSON.parse(draft.contract).inputs;
  async function launch(validation: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const missingNumber = fields.find(
        (field) =>
          field.type === "number" &&
          (!(inputs[field.name] ?? "").trim() ||
            !Number.isFinite(Number(inputs[field.name]))),
      );
      if (missingNumber) {
        setError(`Enter a number for ${missingNumber.name}.`);
        return;
      }
      const values = Object.fromEntries(
        fields.map((field) => [
          field.name,
          field.type === "number"
            ? Number(inputs[field.name])
            : field.type === "boolean"
              ? inputs[field.name] === "true"
              : (inputs[field.name] ?? ""),
        ]),
      );
      const result = await window.awlAgent?.launch(
        {
          id: draft.id,
          sourceChatId: draft.sourceChatId,
          version: draft.version,
        },
        values,
        validation,
      );
      if (result?.chat) onLaunch(result.chat);
      else setError(result?.error ?? "Could not start the run.");
    } catch {
      setError("Could not start the run.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="capability-launch">
      {fields.map((field) => (
        <label key={field.name}>
          {field.name}
          {field.type === "boolean" ? (
            <select
              value={inputs[field.name] ?? "false"}
              onChange={(e) =>
                setInputs({ ...inputs, [field.name]: e.target.value })
              }
            >
              <option value="false">False</option>
              <option value="true">True</option>
            </select>
          ) : (
            <input
              type={field.type === "number" ? "number" : "text"}
              value={inputs[field.name] ?? ""}
              placeholder={field.description}
              maxLength={1000}
              onChange={(e) =>
                setInputs({ ...inputs, [field.name]: e.target.value })
              }
            />
          )}
        </label>
      ))}
      <div className="request-choices">
        <button disabled={busy} onClick={() => void launch(true)}>
          Validate
          {draft.validationCases ? ` · ${draft.validationCases} passed` : ""}
        </button>
        {draft.validation === "validated" && (
          <button disabled={busy} onClick={() => void launch(false)}>
            Run
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
