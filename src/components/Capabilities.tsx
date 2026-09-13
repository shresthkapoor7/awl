import { Code2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SavedCapability } from "../../shared/agent";
import "./capabilities.css";
export function Capabilities() {
  const [drafts, setDrafts] = useState<SavedCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
                    <span>v{draft.version} · draft</span>
                  </div>
                  <p>{draft.description}</p>
                  <details className="capability-contract">
                    <summary>View draft</summary>
                    <pre>{draft.contract}</pre>
                  </details>
                </article>
              ))}
            </div>
            <p className="capabilities-note">Drafts aren’t executable yet.</p>
          </>
        )}
      </div>
    </section>
  );
}
