import type { BrowserBridge } from "../shared/browser";
declare global {
  interface Window {
    awlBrowser?: BrowserBridge;
  }
}
