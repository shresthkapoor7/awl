import type { BrowserBridge } from "../shared/browser";
import type { AgentBridge } from "../shared/agent";
import type { WorkspaceBridge } from "../shared/workspace";
declare global {
  interface Window {
    awlBrowser?: BrowserBridge;
    awlAgent?: AgentBridge;
    awlWorkspace?: WorkspaceBridge;
  }
}
