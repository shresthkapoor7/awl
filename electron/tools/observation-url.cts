import type { BrowserState } from "../../shared/browser.js";
export function observationURL(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? url.origin + url.pathname
      : "about:blank";
  } catch {
    return "about:blank";
  }
}
export function observedBrowserState(state: BrowserState): BrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab, url: observationURL(tab.url) })),
  };
}
