export type BrowserTab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
};
export type BrowserState = {
  agentId: string;
  activeTabId: string;
  tabs: BrowserTab[];
  notice: string | null;
};
export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type BrowserCommand =
  | {
      action: "get" | "back" | "forward" | "reload" | "stop" | "new-tab";
      agentId: string;
    }
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
  onFocusAddress: (listener: () => void) => () => void;
  subscribe: (listener: (state: BrowserState) => void) => () => void;
};
