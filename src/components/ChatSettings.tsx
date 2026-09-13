import { createPortal } from "react-dom";
import { PolicyEditor } from "./PolicyEditor";
import {
  Check,
  ChevronDown,
  Cpu,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionSettings } from "../../shared/session-settings";
import type { AgentChat } from "../../shared/agent";

const modelPresets = [
  { id: "gpt-6-astra", name: "Astra" },
  { id: "gpt-5.6-terra", name: "Terra" },
  { id: "gpt-5.6-luna", name: "Luna" },
];

export function ChatSettings({
  chat,
  defaultModel,
  disabled,
  onSaving,
}: {
  chat: AgentChat;
  defaultModel: string;
  disabled: boolean;
  onSaving: (saving: boolean) => void;
}) {
  const settings = chat.settings ?? {
    model: defaultModel,
    access: "configured" as const,
  };
  const [editor, setEditor] = useState<HTMLElement | null>(null);
  const [model, setModel] = useState(settings.model);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const modelMenu = useRef<HTMLDetailsElement>(null);
  const accessMenu = useRef<HTMLDetailsElement>(null);
  const pending = useRef(false);
  useEffect(() => setModel(settings.model), [settings.model]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (container.current?.contains(event.target as Node)) return;
      if (modelMenu.current) modelMenu.current.open = false;
      if (accessMenu.current) accessMenu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  async function update(next: SessionSettings) {
    if (pending.current || disabled) return;
    pending.current = true;
    setSaving(true);
    onSaving(true);
    setError(null);
    try {
      if (!window.awlAgent) throw new Error("Agent unavailable.");
      const result = await window.awlAgent.configure(chat.id, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (modelMenu.current) modelMenu.current.open = false;
      if (accessMenu.current) accessMenu.current.open = false;
    } catch {
      setError("Could not save chat settings. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
      onSaving(false);
    }
  }
  const locked = disabled || saving;
  const modelOptions = modelPresets.some((option) => option.id === defaultModel)
    ? modelPresets
    : [...modelPresets, { id: defaultModel, name: defaultModel }];
  const modelName =
    modelOptions.find((option) => option.id === settings.model)?.name ??
    settings.model;
  return (
    <div
      ref={container}
      className="chat-settings"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          const menu = (event.target as HTMLElement).closest("details");
          if (menu) {
            menu.open = false;
            menu.querySelector("summary")?.focus();
            event.stopPropagation();
          }
        }
      }}
    >
      <details
        ref={modelMenu}
        className="composer-menu"
        onToggle={(event) => {
          if (event.currentTarget.open && accessMenu.current)
            accessMenu.current.open = false;
        }}
      >
        <summary
          title="Model for discovery and repair"
          aria-label={`Model: ${modelName}`}
        >
          <Cpu size={13} />
          <span>{modelName}</span>
          <ChevronDown size={12} />
        </summary>
        <div className="composer-popover">
          <span className="popover-heading">Model</span>
          <div className="model-options" aria-label="Available model presets">
            {modelOptions.map((option) => (
              <button
                className="model-option"
                type="button"
                key={option.id}
                aria-label={option.name}
                aria-pressed={settings.model === option.id}
                title={option.id}
                disabled={locked}
                onClick={() => void update({ ...settings, model: option.id })}
              >
                <span>{option.name}</span>
                {option.id === defaultModel && <small>Default</small>}
                {settings.model === option.id && (
                  <Check size={14} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          <details className="custom-model">
            <summary>Custom model</summary>
            <label className="sr-only" htmlFor="chat-model">
              OpenAI model ID
            </label>
            <div className="model-entry">
              <input
                id="chat-model"
                aria-label="OpenAI model ID"
                value={model}
                maxLength={160}
                disabled={locked}
                placeholder="OpenAI model ID"
                onChange={(event) => setModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void update({ ...settings, model: model.trim() });
                  }
                }}
              />
              <button
                type="button"
                disabled={locked || !model.trim()}
                onClick={() =>
                  void update({ ...settings, model: model.trim() })
                }
              >
                Use
              </button>
            </div>
          </details>
        </div>
      </details>
      <details
        ref={accessMenu}
        className="composer-menu"
        onToggle={(event) => {
          if (event.currentTarget.open && modelMenu.current)
            modelMenu.current.open = false;
        }}
      >
        <summary
          title="Browser access for this chat"
          aria-label={`Browser access: ${settings.access === "read_only" ? "Read only" : "Configured access"}`}
        >
          {settings.access === "read_only" ? (
            <LockKeyhole size={13} />
          ) : (
            <ShieldCheck size={13} />
          )}
          <span>
            {settings.access === "read_only"
              ? "Read only"
              : "Configured access"}
          </span>
          <ChevronDown size={12} />
        </summary>
        <div className="composer-popover access-popover">
          <span className="popover-heading">Browser access</span>
          {(
            [
              {
                value: "configured",
                name: "Configured access",
                description:
                  "Use the sites and actions allowed by your browser policy.",
              },
              {
                value: "read_only",
                name: "Read only",
                description:
                  "Inspect, navigate, and scroll. No clicks, typing, selections, or key presses.",
              },
            ] as const
          ).map((option) => (
            <button
              type="button"
              key={option.value}
              disabled={locked}
              aria-pressed={settings.access === option.value}
              onClick={() => void update({ ...settings, access: option.value })}
            >
              <strong>
                {option.name}
                {settings.access === option.value && (
                  <span className="setting-selected">Selected</span>
                )}
              </strong>
              <span>{option.description}</span>
            </button>
          ))}
          <button
            type="button"
            className="manage-access"
            disabled={saving}
            onClick={() => {
              const host =
                container.current?.closest<HTMLElement>(".conversation");
              if (!host) return;
              setEditor(host);
              onSaving(true);
              if (accessMenu.current) accessMenu.current.open = false;
            }}
          >
            Manage access…
          </button>
          <p>
            Applies to automation in this chat. You stay in control of manual
            browsing.
          </p>
        </div>
      </details>
      {editor &&
        createPortal(
          <PolicyEditor
            onClose={() => {
              setEditor(null);
              onSaving(false);
              requestAnimationFrame(() =>
                accessMenu.current?.querySelector("summary")?.focus(),
              );
            }}
          />,
          editor,
        )}
      {error && (
        <div className="settings-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss settings error"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
