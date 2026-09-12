export type BrowserTab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  zoom: number;
  detached: boolean;
  device: { enabled: boolean; width: number; height: number };
};
export type BrowserState = {
  agentId: string;
  activeTabId: string;
  tabs: BrowserTab[];
  notice: string | null;
  appearance: "system" | "light" | "dark";
};
export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type BrowserCommand =
  | {
      action:
        | "get"
        | "back"
        | "forward"
        | "reload"
        | "stop"
        | "new-tab"
        | "options"
        | "hard-reload"
        | "devtools"
        | "detach"
        | "reattach"
        | "toggle-device"
        | "clear-cookies"
        | "clear-cache";
      agentId: string;
    }
  | { action: "zoom"; agentId: string; factor: number }
  | {
      action: "appearance";
      agentId: string;
      theme: "system" | "light" | "dark";
    }
  | { action: "device-size"; agentId: string; width: number; height: number }
  | { action: "navigate"; agentId: string; url: string }
  | { action: "select-tab" | "close-tab"; agentId: string; tabId: string };
export type BrowserResult = { state?: BrowserState; error?: string };
export type BrowserBridge = {
  command: (command: BrowserCommand) => Promise<BrowserResult>;
  present: (
    agentId: string,
    lease: string,
    bounds: BrowserBounds,
  ) => Promise<void>;
  hide: (lease: string) => Promise<void>;
  onExitFullscreen: (listener: () => void) => () => void;
  onFocusAddress: (listener: () => void) => () => void;
  subscribe: (listener: (state: BrowserState) => void) => () => void;
};
