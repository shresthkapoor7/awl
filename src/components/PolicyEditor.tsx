import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  policyActions,
  policySchema,
  type PolicyConfig,
  type PolicyState,
} from "../../shared/policy";

const actionLabels = {
  navigate: "Navigate",
  click: "Click",
  fill: "Type",
  select: "Select",
  press: "Press keys",
  scroll: "Scroll",
};
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
export function PolicyEditor({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PolicyState | null>(null);
  const [draft, setDraft] = useState<PolicyConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (!window.awlAgent) throw new Error();
      const result = await window.awlAgent.policy();
      if (!mounted.current) return;
      if (!result.state) {
        setError(result.error ?? "Could not load access rules.");
        return;
      }
      setState(result.state);
      setDraft(structuredClone(result.state.config));
    } catch {
      if (mounted.current) setError("Could not load access rules. Try again.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const editor = heading.current?.closest(".policy-editor");
    const siblings = [...(editor?.parentElement?.children ?? [])].filter(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item !== editor,
    );
    const previous = siblings.map((item) => item.inert);
    siblings.forEach((item) => {
      item.inert = true;
    });
    heading.current?.focus();
    void load();
    return () => {
      mounted.current = false;
      siblings.forEach((item, index) => {
        item.inert = previous[index]!;
      });
    };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!draft || !state || pending.current || loading) return;
    const normalized = {
      ...draft,
      destinations: draft.destinations.map((site) => ({
        ...site,
        paths: lines(site.paths.join("\n")),
      })),
      blockedControls: lines(draft.blockedControls.join("\n")),
      sensitiveSelectors: lines(draft.sensitiveSelectors.join("\n")),
    };
    const parsed = policySchema.safeParse(normalized);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the access rules.");
      return;
    }
    // Validate CSS using the same Chromium parser used by browser targeting.
    for (const selector of [
      ...parsed.data.safeControls.map((rule) => rule.selector),
      ...parsed.data.blockedControls,
      ...parsed.data.sensitiveSelectors,
    ]) {
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch {
        setError(`Invalid CSS selector: ${selector}`);
        return;
      }
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!window.awlAgent) throw new Error();
      const result = await window.awlAgent.savePolicy(
        parsed.data,
        state.revision,
      );
      if (!mounted.current) return;
      if (!result.state) {
        setError(result.error ?? "Could not save access rules.");
        return;
      }
      onClose();
    } catch {
      if (mounted.current) setError("Could not save access rules. Try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const locked = loading || saving;
  return (
    <section
      className="policy-editor"
      role="dialog"
      aria-labelledby="policy-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!saving) onClose();
        }
      }}
    >
      <header>
        <div>
          <h2 id="policy-title" ref={heading} tabIndex={-1}>
            Manage access
          </h2>
          <p>Workspace rules · applies to all chats</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close access editor"
          disabled={saving}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <form noValidate onSubmit={(event) => void save(event)}>
        <div className="policy-fields">
          {loading && <p role="status">Loading access rules…</p>}
          {draft && (
            <fieldset disabled={locked}>
              <div className="policy-section-heading">
                <h3>Allowed websites</h3>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      destinations: [
                        ...draft.destinations,
                        { origin: "", paths: ["/*"] },
                      ],
                    })
                  }
                >
                  <Plus size={13} /> Add website
                </button>
              </div>
              <p className="policy-hint">
                Exact website origins. Use /* for all paths, or list specific
                paths on separate lines.
              </p>
              {!draft.destinations.length && (
                <p className="policy-empty">No websites allowed yet.</p>
              )}
              {draft.destinations.map((site, index) => (
                <div className="policy-rule" key={index}>
                  <div className="policy-row">
                    <label>
                      Website {index + 1}
                      <input
                        aria-label={`Website ${index + 1}`}
                        type="url"
                        required
                        placeholder="https://example.com"
                        value={site.origin}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            destinations: draft.destinations.map((item, i) =>
                              i === index
                                ? { ...item, origin: event.target.value.trim() }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Remove website ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          destinations: draft.destinations.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <label>
                    Allowed paths
                    <textarea
                      aria-label={`Paths for website ${index + 1}`}
                      rows={2}
                      required
                      value={site.paths.join("\n")}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          destinations: draft.destinations.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  paths: event.target.value.split("\n"),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <h3>Allowed actions</h3>
              <div className="policy-actions">
                {policyActions.map((action) => (
                  <label key={action}>
                    <input
                      type="checkbox"
                      checked={draft.actions.includes(action)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          actions: event.target.checked
                            ? [...draft.actions, action]
                            : draft.actions.filter((item) => item !== action),
                        })
                      }
                    />
                    {actionLabels[action]}
                  </label>
                ))}
              </div>
              <p className="policy-hint">
                Read only chats keep their narrower access. Sensitive input and
                high-risk actions still require you.
              </p>
              <details className="policy-advanced">
                <summary>Controls and privacy</summary>
                <div className="policy-section-heading">
                  <h3>Approved controls</h3>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        safeControls: [
                          ...draft.safeControls,
                          {
                            origin: draft.destinations[0]?.origin ?? "",
                            path: "/*",
                            selector: "",
                            actions: ["click", "press"],
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={13} /> Add control
                  </button>
                </div>
                <p className="policy-hint">
                  Approve specific buttons or form submissions using CSS
                  selectors. Website and action restrictions still apply.
                </p>
                {draft.safeControls.map((rule, index) => (
                  <div className="policy-rule" key={index}>
                    <div className="policy-row">
                      <label>
                        Website
                        <input
                          aria-label={`Control ${index + 1} website`}
                          type="url"
                          required
                          value={rule.origin}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              safeControls: draft.safeControls.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      origin: event.target.value.trim(),
                                    }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove control ${index + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            safeControls: draft.safeControls.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <label>
                      Path
                      <input
                        aria-label={`Control ${index + 1} path`}
                        required
                        value={rule.path}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            safeControls: draft.safeControls.map((item, i) =>
                              i === index
                                ? { ...item, path: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      CSS selector
                      <input
                        aria-label={`Control ${index + 1} selector`}
                        required
                        placeholder='button[type="submit"]'
                        value={rule.selector}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            safeControls: draft.safeControls.map((item, i) =>
                              i === index
                                ? { ...item, selector: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="policy-actions">
                      {policyActions.map((action) => (
                        <label key={action}>
                          <input
                            aria-label={`Control ${index + 1}: ${actionLabels[action]}`}
                            type="checkbox"
                            checked={rule.actions.includes(action)}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                safeControls: draft.safeControls.map(
                                  (item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          actions: event.target.checked
                                            ? [...item.actions, action]
                                            : item.actions.filter(
                                                (value) => value !== action,
                                              ),
                                        }
                                      : item,
                                ),
                              })
                            }
                          />
                          {actionLabels[action]}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <label>
                  Blocked controls
                  <textarea
                    aria-label="Blocked controls"
                    rows={3}
                    placeholder="One CSS selector per line"
                    value={draft.blockedControls.join("\n")}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        blockedControls: event.target.value.split("\n"),
                      })
                    }
                  />
                </label>
                <label>
                  Private fields
                  <textarea
                    aria-label="Private fields"
                    rows={3}
                    placeholder="One CSS selector per line"
                    value={draft.sensitiveSelectors.join("\n")}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        sensitiveSelectors: event.target.value.split("\n"),
                      })
                    }
                  />
                </label>
                <p className="policy-hint">
                  Private fields are excluded from captured observations.
                </p>
              </details>
            </fieldset>
          )}
          {error && (
            <p className="policy-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span>
            {state?.external
              ? "Saves to your configured policy file"
              : "Saved on this computer"}
          </span>
          <button type="button" disabled={locked} onClick={() => void load()}>
            Reload
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="policy-save"
            disabled={locked || !draft}
          >
            {saving ? "Saving…" : "Save access"}
          </button>
        </footer>
      </form>
    </section>
  );
}
