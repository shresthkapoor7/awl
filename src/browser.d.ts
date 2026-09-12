import type { BrowserBridge } from "../shared/browser";
import type { AgentBridge } from "../shared/agent";
declare global {
  interface Window {
    awlBrowser?: BrowserBridge;
    awlAgent?: AgentBridge;
  }
}
