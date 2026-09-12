import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  LoaderCircle,
  MoreHorizontal,
  RotateCw,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { BrowserCommand, BrowserState } from "../../shared/browser";
import { IconButton } from "./ui";
import "./live-browser.css";

type Props = { agentId: string; visible: boolean };
export function LiveBrowser({ agentId, visible }: Props) {
  const bridge = window.awlBrowser;
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const tab = state?.tabs.find((tab) => tab.id === state.activeTabId);
  const command = useCallback(
    async (action: BrowserCommand) => {
      if (!bridge) return;
      try {
        const result = await bridge.command(action);
        setError(result.error ?? null);
        if (result.state) setState(result.state);
      } catch {
        setError(
          "The browser connection was interrupted. Restart awl to reconnect.",
        );
      }
    },
    [bridge],
  );
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.subscribe((next) => {
      if (next.agentId === agentId) setState(next);
    });
    void command({ action: "get", agentId });
    return unsubscribe;
  }, [agentId, bridge, command]);
  useEffect(() => {
    // A late session snapshot or page redirect must not erase an address the
    // user is currently typing.
    if (document.activeElement !== addressInput.current)
      setAddress(tab?.url === "about:blank" ? "" : (tab?.url ?? ""));
  }, [tab?.url, tab?.id]);
  useEffect(() => {
    if (!bridge) return;
    const focus = () => {
      if (visible) {
        addressInput.current?.focus();
        addressInput.current?.select();
      }
    };
    const unsubscribe = bridge.onFocusAddress(focus);
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "l" &&
        visible
      ) {
        event.preventDefault();
        focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", keydown);
    };
  }, [bridge, visible]);
  useLayoutEffect(() => {
    if (!bridge || !surface.current || !visible) return;
    const element = surface.current;
    const lease = crypto.randomUUID();
    let disposed = false;
    let frame = 0;
    const sync = () => {
      if (disposed) return;
      const { x, y, width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0 && element.checkVisibility()) {
        void bridge
          .present(agentId, lease, { x, y, width, height })
          .catch(() => {});
      } else void bridge.hide(lease).catch(() => {});
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    sync();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      void bridge.hide(lease).catch(() => {});
    };
  }, [agentId, bridge, visible]);

  const blank = !tab || tab.url === "about:blank" || !tab.url;
  return (
    <div className="live-browser" hidden={!visible}>
      <div className="browser-tabs" aria-label="Browser tabs">
        {state?.tabs.map((item) => (
          <div
            className={`browser-tab ${item.id === state.activeTabId ? "selected" : ""}`}
            key={item.id}
          >
            <button
              aria-pressed={item.id === state.activeTabId}
              title={item.title}
              onClick={() =>
                void command({ action: "select-tab", agentId, tabId: item.id })
              }
            >
              {item.loading ? (
                <LoaderCircle className="browser-spinner" size={12} />
              ) : (
                <Globe2 size={12} />
              )}
              <span>{item.url === "about:blank" ? "New tab" : item.title}</span>
            </button>
            <IconButton
              label={`Close ${item.title}`}
              onClick={() =>
                void command({ action: "close-tab", agentId, tabId: item.id })
              }
            >
              <X size={11} />
            </IconButton>
          </div>
        ))}
        <IconButton
          label="New browser tab"
          disabled={!bridge}
          onClick={() => void command({ action: "new-tab", agentId })}
        >
          <Plus size={14} />
        </IconButton>
        <IconButton
          label="Browser options"
          disabled={!bridge || !tab}
          onClick={() => void command({ action: "options", agentId })}
        >
          <MoreHorizontal size={16} />
        </IconButton>
      </div>
      <form
        className="address-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void command({ action: "navigate", agentId, url: address });
          addressInput.current?.blur();
        }}
      >
        <IconButton
          label="Back"
          disabled={!tab?.canGoBack}
          onClick={() => void command({ action: "back", agentId })}
        >
          <ArrowLeft size={14} />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => void command({ action: "forward", agentId })}
        >
          <ArrowRight size={14} />
        </IconButton>
        <IconButton
          label={tab?.loading ? "Stop loading" : "Reload page"}
          disabled={!bridge || blank}
          onClick={() =>
            void command({ action: tab?.loading ? "stop" : "reload", agentId })
          }
        >
          {tab?.loading ? <X size={14} /> : <RotateCcw size={14} />}
        </IconButton>
        <input
          ref={addressInput}
          className="browser-address"
          aria-label="Website address"
          placeholder="Enter a website…"
          spellCheck={false}
          autoComplete="off"
          value={address}
          disabled={!bridge}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setAddress(tab?.url === "about:blank" ? "" : (tab?.url ?? ""));
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="submit"
          className="icon-button"
          aria-label="Go to website"
          disabled={!bridge || !address.trim()}
        >
          <ArrowRight size={14} />
        </button>
      </form>
      {tab?.device.enabled && (
        <DeviceToolbar
          key={tab.id}
          width={tab.device.width}
          height={tab.device.height}
          onSize={(width, height) =>
            void command({ action: "device-size", agentId, width, height })
          }
          onClose={() => void command({ action: "toggle-device", agentId })}
        />
      )}
      <div className="control-strip">
        <span>You’re in control</span>
        <span className="control-detail">Local browser</span>
      </div>
      {(error || state?.notice) && (
        <p className="browser-notice" role="status">
          {error || state?.notice}
        </p>
      )}
      <div
        ref={surface}
        className="browser-surface"
        data-agent-id={agentId}
        aria-label="Live website"
      >
        {!bridge ? (
          <div className="browser-placeholder">
            <Globe2 size={28} />
            <h2>Open awl on your desktop.</h2>
            <p>The live browser is available in the Electron app.</p>
          </div>
        ) : tab?.detached ? (
          <div className="browser-placeholder">
            <Globe2 size={28} />
            <h2>Open in a separate window.</h2>
            <button
              className="text-button"
              onClick={() => void command({ action: "reattach", agentId })}
            >
              Return to workspace <ArrowLeft size={14} />
            </button>
          </div>
        ) : tab?.error ? (
          <div className="browser-placeholder" role="status">
            <h2>This page couldn’t open.</h2>
            <p>{tab.error}</p>
            <button
              className="text-button"
              onClick={() => void command({ action: "reload", agentId })}
            >
              Try again <RotateCcw size={13} />
            </button>
          </div>
        ) : blank ? (
          <div className="browser-placeholder">
            <Globe2 size={28} strokeWidth={1} />
            <h2>Where are we going?</h2>
            <p>Enter a website above to get started.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeviceToolbar({
  width,
  height,
  onSize,
  onClose,
}: {
  width: number;
  height: number;
  onSize: (width: number, height: number) => void;
  onClose: () => void;
}) {
  const [draftWidth, setDraftWidth] = useState(String(width));
  const [draftHeight, setDraftHeight] = useState(String(height));
  useEffect(() => {
    setDraftWidth(String(width));
    setDraftHeight(String(height));
  }, [width, height]);
  const presets = [
    { label: "Phone", width: 390, height: 844 },
    { label: "Tablet", width: 768, height: 1024 },
    { label: "Laptop", width: 1280, height: 800 },
  ];
  const preset =
    presets.find((item) => item.width === width && item.height === height)
      ?.label ?? "Custom";
  return (
    <form
      className="device-toolbar"
      aria-label="Device toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        onSize(Number(draftWidth), Number(draftHeight));
      }}
    >
      <select
        aria-label="Device preset"
        value={preset}
        onChange={(event) => {
          const size = presets.find(
            (item) => item.label === event.target.value,
          );
          if (size) onSize(size.width, size.height);
        }}
      >
        {presets.map((item) => (
          <option key={item.label}>{item.label}</option>
        ))}
        <option value="Custom" disabled>
          Custom
        </option>
      </select>
      <input
        type="number"
        min={240}
        max={3840}
        aria-label="Viewport width"
        value={draftWidth}
        onChange={(event) => setDraftWidth(event.target.value)}
      />
      <span>×</span>
      <input
        type="number"
        min={240}
        max={3840}
        aria-label="Viewport height"
        value={draftHeight}
        onChange={(event) => setDraftHeight(event.target.value)}
      />
      <button
        type="submit"
        className="icon-button"
        aria-label="Apply viewport size"
      >
        <ArrowRight size={13} />
      </button>
      <IconButton label="Rotate viewport" onClick={() => onSize(height, width)}>
        <RotateCw size={14} />
      </IconButton>
      <IconButton label="Hide device toolbar" onClick={onClose}>
        <X size={13} />
      </IconButton>
    </form>
  );
}
