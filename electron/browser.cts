import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron";
import { randomUUID } from "node:crypto";
import type {
  BrowserState,
  BrowserBounds,
  BrowserResult,
} from "../shared/browser.js";

type Tab = {
  id: string;
  view: WebContentsView;
  requestedURL: string;
  error: string | null;
};
type AgentBrowser = {
  id: string;
  session: Session;
  tabs: Tab[];
  active: string;
  notice: string | null;
};
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const webURL = (value: string) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
function normalizeURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || !value.trim())
    throw new Error("Enter a website address.");
  const input = value.trim();
  if (input === "about:blank") return input;
  const hasScheme =
    /^[a-z][a-z\d+.-]*:/i.test(input) &&
    !/^(localhost|[\w.-]+\.\w+):\d+(\/|$)/i.test(input);
  const url = hasScheme
    ? input
    : `${/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(input) ? "http" : "https"}://${input}`;
  if (!webURL(url))
    throw new Error(
      "Use an HTTP or HTTPS address without embedded credentials.",
    );
  return new URL(url).href;
}

export function installBrowser(window: BrowserWindow) {
  const browsers = new Map<string, AgentBrowser>();
  const launchId = randomUUID();
  let presentation: {
    agentId: string;
    lease: string;
    bounds: BrowserBounds;
  } | null = null;
  let attached: WebContentsView | null = null;
  let disposed = false;

  function authorize(event: IpcMainInvokeEvent) {
    if (
      disposed ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error(
        "Browser controls are only available to the awl workspace.",
      );
  }
  function state(browser: AgentBrowser): BrowserState {
    return {
      agentId: browser.id,
      activeTabId: browser.active,
      notice: browser.notice,
      tabs: browser.tabs.map((tab) => {
        const wc = tab.view.webContents;
        return {
          id: tab.id,
          title: wc.getTitle() || "New tab",
          url: tab.error ? tab.requestedURL : wc.getURL() || tab.requestedURL,
          loading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          error: tab.error,
        };
      }),
    };
  }
  function detach() {
    if (attached && !window.isDestroyed()) {
      attached.setVisible(false);
      window.contentView.removeChildView(attached);
    }
    attached = null;
  }
  function layout() {
    if (disposed || window.isDestroyed()) return;
    const browser = presentation && browsers.get(presentation.agentId);
    const tab =
      browser && browser.tabs.find((tab) => tab.id === browser.active);
    const show =
      presentation && tab && !tab.error && tab.requestedURL !== "about:blank";
    const view = show ? tab.view : null;
    if (attached !== view) {
      detach();
      if (view) {
        window.contentView.addChildView(view);
        attached = view;
      }
    }
    for (const item of browsers.values())
      for (const tab of item.tabs)
        if (!tab.view.webContents.isDestroyed())
          tab.view.webContents.setAudioMuted(tab.view !== view);
    if (!view || !presentation) return;
    const factor = window.webContents.getZoomFactor();
    const area = window.getContentBounds();
    const rect = presentation.bounds;
    const x = Math.max(0, Math.min(area.width, Math.round(rect.x * factor)));
    const y = Math.max(0, Math.min(area.height, Math.round(rect.y * factor)));
    const width = Math.max(
      0,
      Math.min(area.width - x, Math.round(rect.width * factor)),
    );
    const height = Math.max(
      0,
      Math.min(area.height - y, Math.round(rect.height * factor)),
    );
    view.setBounds({ x, y, width, height });
    view.setVisible(width > 0 && height > 0);
  }
  function publish(browser: AgentBrowser) {
    if (disposed || window.isDestroyed()) return;
    layout();
    window.webContents.send("browser:state", state(browser));
  }
  function removeTab(browser: AgentBrowser, tab: Tab, close = true) {
    if (attached === tab.view) detach();
    browser.tabs = browser.tabs.filter((item) => item !== tab);
    if (browser.active === tab.id)
      browser.active = browser.tabs.at(-1)?.id ?? "";
    if (close && !tab.view.webContents.isDestroyed())
      tab.view.webContents.close({ waitForBeforeUnload: false });
    if (!browser.tabs.length && !disposed) createTab(browser);
    publish(browser);
  }
  function createTab(browser: AgentBrowser, existing?: WebContents): Tab {
    if (browser.tabs.length >= 12)
      throw new Error("Close a tab before opening another (12 per agent).");
    const preferences: WebPreferences = {
      session: browser.session,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    };
    const view = new WebContentsView(
      existing ? { webContents: existing } : { webPreferences: preferences },
    );
    const tab: Tab = {
      id: randomUUID(),
      view,
      requestedURL: "about:blank",
      error: null,
    };
    view.setBackgroundColor("#0a0a0a");
    browser.tabs.push(tab);
    browser.active = tab.id;
    const wc = view.webContents;
    wc.setWindowOpenHandler((details) => {
      if (
        (!webURL(details.url) && details.url !== "about:blank") ||
        browser.tabs.length >= 12
      ) {
        browser.notice =
          "That popup could not be opened. Only web pages are supported, with up to 12 tabs per agent.";
        publish(browser);
        return { action: "deny" };
      }
      return {
        action: "allow",
        overrideBrowserWindowOptions: { webPreferences: preferences },
        createWindow: (options) => {
          const popup = createTab(
            browser,
            (options as { webContents?: WebContents }).webContents,
          );
          popup.requestedURL = details.url;
          if (details.disposition === "background-tab")
            void load(browser, popup, details.url);
          publish(browser);
          return popup.view.webContents;
        },
      };
    });
    const guard = (
      event: Electron.Event & { url: string; isMainFrame: boolean },
    ) => {
      if (
        event.isMainFrame &&
        !webURL(event.url) &&
        event.url !== "about:blank"
      ) {
        event.preventDefault();
        browser.notice =
          "This browser supports HTTP and HTTPS pages. External app links stay blocked.";
        publish(browser);
      }
    };
    wc.on("will-frame-navigate", guard);
    wc.on("will-redirect", guard);
    wc.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        tab.error = null;
        tab.requestedURL = details.url;
      }
      publish(browser);
    });
    const changed = () => publish(browser);
    wc.on("did-start-loading", changed);
    wc.on("did-stop-loading", changed);
    wc.on("did-navigate", changed);
    wc.on("did-navigate-in-page", changed);
    wc.on("page-title-updated", changed);
    wc.on("did-fail-load", (_event, code, description, url, mainFrame) => {
      if (mainFrame && code !== -3) {
        tab.error = `Couldn’t load this page (${description}).`;
        tab.requestedURL = url;
        publish(browser);
      }
    });
    wc.on("render-process-gone", () => {
      tab.error = "This tab stopped responding. Reload to try again.";
      publish(browser);
    });
    wc.on("destroyed", () => {
      if (!disposed && browser.tabs.includes(tab))
        removeTab(browser, tab, false);
    });
    wc.on("before-input-event", (event, input) => {
      if ((input.control || input.meta) && input.key.toLowerCase() === "l") {
        event.preventDefault();
        window.webContents.focus();
        window.webContents.send("browser:focus-address");
      }
    });
    return tab;
  }
  function getBrowser(id: unknown): AgentBrowser {
    if (!identifier(id)) throw new Error("Invalid agent session.");
    const existing = browsers.get(id);
    if (existing) return existing;
    if (browsers.size >= 32)
      throw new Error("This workspace has reached its browser session limit.");
    const isolated = session.fromPartition(`awl-${launchId}-${id}`);
    isolated.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    isolated.setPermissionCheckHandler(() => false);
    const browser: AgentBrowser = {
      id,
      session: isolated,
      tabs: [],
      active: "",
      notice: null,
    };
    isolated.on("will-download", (event) => {
      event.preventDefault();
      browser.notice = "Downloads aren’t connected yet.";
      publish(browser);
    });
    browsers.set(id, browser);
    createTab(browser);
    return browser;
  }
  async function load(browser: AgentBrowser, tab: Tab, url: string) {
    tab.error = null;
    tab.requestedURL = url;
    browser.notice = null;
    publish(browser);
    try {
      await tab.view.webContents.loadURL(url);
    } catch (error) {
      if (
        disposed ||
        tab.view.webContents.isDestroyed() ||
        !browser.tabs.includes(tab)
      )
        return;
      // ERR_ABORTED is expected when another navigation or Stop supersedes this.
      if (
        !(error instanceof Error && error.message.includes("ERR_ABORTED")) &&
        tab.requestedURL === url
      ) {
        tab.error =
          "Couldn’t load this page. Check the address and connection, then reload.";
        publish(browser);
      }
    }
  }
  ipcMain.handle("browser:command", (event, input: unknown): BrowserResult => {
    authorize(event);
    try {
      if (
        !input ||
        typeof input !== "object" ||
        !("action" in input) ||
        !("agentId" in input)
      )
        throw new Error("Invalid browser command.");
      const browser = getBrowser(input.agentId);
      const tab = browser.tabs.find((tab) => tab.id === browser.active)!;
      const wc = tab.view.webContents;
      browser.notice = null;
      switch (input.action) {
        case "get":
          break;
        case "navigate":
          void load(
            browser,
            tab,
            normalizeURL("url" in input ? input.url : null),
          );
          break;
        case "back":
          if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
          break;
        case "forward":
          if (wc.navigationHistory.canGoForward())
            wc.navigationHistory.goForward();
          break;
        case "reload":
          if (tab.error) void load(browser, tab, tab.requestedURL);
          else wc.reload();
          break;
        case "stop":
          wc.stop();
          break;
        case "new-tab":
          createTab(browser);
          break;
        case "select-tab":
        case "close-tab": {
          const target = browser.tabs.find(
            (tab) => "tabId" in input && tab.id === input.tabId,
          );
          if (!target) throw new Error("That tab is no longer available.");
          if (input.action === "select-tab") browser.active = target.id;
          else removeTab(browser, target);
          break;
        }
        default:
          throw new Error("Unknown browser command.");
      }
      publish(browser);
      return { state: state(browser) };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Browser request failed.",
      };
    }
  });
  ipcMain.handle("browser:present", (event, input) => {
    authorize(event);
    if (
      !input ||
      !identifier(input.agentId) ||
      !identifier(input.lease) ||
      !input.bounds
    )
      return;
    const bounds = input.bounds as BrowserBounds;
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      return;
    getBrowser(input.agentId);
    presentation = { agentId: input.agentId, lease: input.lease, bounds };
    layout();
  });
  ipcMain.handle("browser:hide", (event, lease) => {
    authorize(event);
    if (presentation?.lease === lease) {
      presentation = null;
      layout();
    }
  });
  // Renderer reloads retain browser sessions but must explicitly reattach views.
  window.webContents.on("did-start-loading", () => {
    presentation = null;
    detach();
  });
  window.on("resize", layout);
  window.on("closed", () => {
    disposed = true;
    for (const channel of [
      "browser:command",
      "browser:present",
      "browser:hide",
    ])
      ipcMain.removeHandler(channel);
    for (const browser of browsers.values())
      for (const tab of browser.tabs)
        if (!tab.view.webContents.isDestroyed())
          tab.view.webContents.close({ waitForBeforeUnload: false });
    browsers.clear();
  });
}
