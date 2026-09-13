import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  WebContentsView,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron";
import { installWorkspaceShortcuts } from "./workspace-shortcuts.cjs";
import { automationInput } from "./tools/page.cjs";
import { randomUUID } from "node:crypto";
import { ToolError, type BrowserAccess } from "./tools/core.cjs";
import type {
  BrowserState,
  BrowserBounds,
  BrowserResult,
  BrowserCommand,
} from "../shared/browser.js";

type Tab = {
  id: string;
  view: WebContentsView;
  requestedURL: string;
  error: string | null;
  preview: BrowserWindow | null;
  device: { enabled: boolean; width: number; height: number };
  viewportKey: string;
  emulating: boolean;
  ready: boolean;
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

export function installBrowser(window: BrowserWindow): BrowserAccess {
  const owners = new Map<string, "human" | "agent">();
  let humanInput: ((id: string) => void) | undefined;
  const interruptHumanInput = (id: string) => {
    if (owners.get(id) !== "agent") return false;
    humanInput?.(id);
    return true;
  };
  const browsers = new Map<string, AgentBrowser>();
  const launchId = randomUUID();
  let presentation: {
    agentId: string;
    lease: string;
    bounds: BrowserBounds;
  } | null = null;
  let attached: WebContentsView | null = null;
  let disposed = false;
  let quitting = false;
  const beforeQuit = () => {
    quitting = true;
  };
  app.on("before-quit", beforeQuit);

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
      appearance: nativeTheme.themeSource,
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
          zoom: wc.getZoomFactor(),
          detached: !!tab.preview,
          device: { ...tab.device },
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
  function applyViewport(tab: Tab, bounds: BrowserBounds) {
    const { width, height, x, y } = bounds;
    const device = tab.device;
    const scale = Math.min(width / device.width, height / device.height, 1);
    const key = `${width}:${height}:${device.enabled}:${device.width}:${device.height}`;
    if (device.enabled) {
      const fittedWidth = Math.max(1, Math.floor(device.width * scale));
      const fittedHeight = Math.max(1, Math.floor(device.height * scale));
      tab.view.setBounds({
        x: x + Math.floor((width - fittedWidth) / 2),
        y: y + Math.floor((height - fittedHeight) / 2),
        width: fittedWidth,
        height: fittedHeight,
      });
      if (tab.ready && tab.viewportKey !== key) {
        tab.view.webContents.enableDeviceEmulation({
          screenPosition: "mobile",
          screenSize: { width: device.width, height: device.height },
          viewPosition: { x: 0, y: 0 },
          deviceScaleFactor: 1,
          viewSize: { width: device.width, height: device.height },
          scale,
        });
        tab.emulating = true;
      }
    } else {
      if (tab.emulating) {
        tab.view.webContents.disableDeviceEmulation();
        tab.emulating = false;
      }
      tab.view.setBounds(bounds);
    }
    tab.viewportKey = tab.ready ? key : "";
    tab.view.setVisible(width > 0 && height > 0);
  }
  function layoutPreview(tab: Tab) {
    if (!tab.preview || tab.preview.isDestroyed()) return;
    const { width, height } = tab.preview.getContentBounds();
    applyViewport(tab, { x: 0, y: 0, width, height });
  }
  function returnToWorkspace(browser: AgentBrowser, tab: Tab) {
    const preview = tab.preview;
    if (!preview) return;
    tab.preview = null;
    if (!preview.isDestroyed()) {
      preview.contentView.removeChildView(tab.view);
      preview.destroy();
    }
    tab.viewportKey = "";
    publish(browser);
  }
  function openPreview(browser: AgentBrowser, tab: Tab) {
    if (tab.preview) {
      tab.preview.show();
      tab.preview.focus();
      return;
    }
    if (attached === tab.view) detach();
    const preview = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 360,
      minHeight: 300,
      title: `${tab.view.webContents.getTitle() || "Browser"} — awl preview`,
      backgroundColor: "#0a0a0a",
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-navigate", (event) => event.preventDefault());
    tab.preview = preview;
    tab.viewportKey = "";
    preview.contentView.addChildView(tab.view);
    preview.on("resize", () => layoutPreview(tab));
    preview.on("close", (event) => {
      if (quitting) {
        preview.contentView.removeChildView(tab.view);
        tab.preview = null;
        return;
      }
      event.preventDefault();
      returnToWorkspace(browser, tab);
    });
    layoutPreview(tab);
    preview.show();
    publish(browser);
  }
  async function browserTool(
    browser: AgentBrowser,
    tab: Tab,
    input: BrowserCommand,
  ) {
    const wc = tab.view.webContents;
    if (input.action !== "options" && interruptHumanInput(browser.id))
      throw new Error("Agent paused. Try the browser action again.");
    switch (input.action) {
      case "hard-reload":
        if (tab.error) {
          tab.error = null;
          void load(browser, tab, tab.requestedURL);
        } else wc.reloadIgnoringCache();
        break;
      case "devtools":
        wc.openDevTools({ mode: "detach" });
        break;
      case "detach":
        openPreview(browser, tab);
        break;
      case "reattach":
        returnToWorkspace(browser, tab);
        break;
      case "toggle-device":
        tab.device.enabled = !tab.device.enabled;
        break;
      case "device-size":
        if (
          ![input.width, input.height].every(
            (value) => Number.isInteger(value) && value >= 240 && value <= 3840,
          )
        )
          throw new Error(
            "Device dimensions must be between 240 and 3840 pixels.",
          );
        tab.device = {
          enabled: true,
          width: input.width,
          height: input.height,
        };
        break;
      case "zoom":
        if (
          typeof input.factor !== "number" ||
          !Number.isFinite(input.factor) ||
          input.factor < 0.25 ||
          input.factor > 3
        )
          throw new Error("Zoom must be between 25% and 300%.");
        wc.setZoomFactor(input.factor);
        break;
      case "appearance":
        if (!["system", "light", "dark"].includes(input.theme))
          throw new Error("Invalid appearance.");
        nativeTheme.themeSource = input.theme;
        break;
      case "clear-cookies":
        await browser.session.clearStorageData({ storages: ["cookies"] });
        browser.notice = "Cookies cleared for this agent.";
        break;
      case "clear-cache":
        await browser.session.clearCache();
        browser.notice = "Cache cleared for this agent.";
        break;
      case "options": {
        const run = (command: BrowserCommand) => {
          void browserTool(browser, tab, command)
            .then(() => publish(browser))
            .catch((error) => {
              if (disposed || wc.isDestroyed()) return;
              browser.notice =
                error instanceof Error
                  ? error.message
                  : "Browser action failed.";
              publish(browser);
            });
        };
        const agentId = browser.id;
        const zoom = wc.getZoomFactor();
        const menu = Menu.buildFromTemplate([
          {
            id: "hard-reload",
            label: "Hard reload",
            click: () => run({ action: "hard-reload", agentId }),
          },
          {
            id: "devtools",
            label: "Open DevTools",
            click: () => run({ action: "devtools", agentId }),
          },
          {
            id: "preview",
            label: tab.preview
              ? "Return preview to workspace"
              : "Open separate preview window",
            click: () =>
              run({ action: tab.preview ? "reattach" : "detach", agentId }),
          },
          {
            id: "device",
            label: tab.device.enabled
              ? "Hide device toolbar"
              : "Show device toolbar",
            click: () => run({ action: "toggle-device", agentId }),
          },
          {
            label: "Appearance",
            submenu: (["system", "light", "dark"] as const).map((theme) => ({
              id: `appearance-${theme}`,
              label:
                theme === "system"
                  ? "System"
                  : theme === "dark"
                    ? "Dark"
                    : "Light",
              type: "radio" as const,
              checked: nativeTheme.themeSource === theme,
              click: () => run({ action: "appearance", agentId, theme }),
            })),
          },
          { type: "separator" },
          {
            label: `Zoom · ${Math.round(zoom * 100)}%`,
            submenu: [
              {
                id: "zoom-out",
                label: "Zoom out",
                enabled: zoom > 0.25,
                click: () =>
                  run({
                    action: "zoom",
                    agentId,
                    factor: Math.max(
                      0.25,
                      Math.round((zoom - 0.1) * 100) / 100,
                    ),
                  }),
              },
              {
                id: "zoom-reset",
                label: "Reset to 100%",
                click: () => run({ action: "zoom", agentId, factor: 1 }),
              },
              {
                id: "zoom-in",
                label: "Zoom in",
                enabled: zoom < 3,
                click: () =>
                  run({
                    action: "zoom",
                    agentId,
                    factor: Math.min(3, Math.round((zoom + 0.1) * 100) / 100),
                  }),
              },
            ],
          },
          { type: "separator" },
          { label: "Profile: This agent", enabled: false },
          {
            id: "clear-cookies",
            label: "Clear cookies",
            click: () => run({ action: "clear-cookies", agentId }),
          },
          {
            id: "clear-cache",
            label: "Clear cache",
            click: () => run({ action: "clear-cache", agentId }),
          },
        ]);
        menu.popup({ window });
        break;
      }
      default:
        throw new Error("Unknown browser command.");
    }
    layoutPreview(tab);
  }

  function layout() {
    if (disposed || window.isDestroyed()) return;
    const browser = presentation && browsers.get(presentation.agentId);
    const tab =
      browser && browser.tabs.find((tab) => tab.id === browser.active);
    const show =
      presentation &&
      tab &&
      !tab.preview &&
      !tab.error &&
      tab.requestedURL !== "about:blank";
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
          tab.view.webContents.setAudioMuted(tab.view !== view && !tab.preview);
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
    applyViewport(tab!, { x, y, width, height });
  }
  function publish(browser: AgentBrowser) {
    if (disposed || window.isDestroyed()) return;
    layout();
    window.webContents.send("browser:state", state(browser));
  }
  function removeTab(browser: AgentBrowser, tab: Tab, close = true) {
    if (tab.preview) returnToWorkspace(browser, tab);
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
      backgroundThrottling: false,
    };
    const view = new WebContentsView(
      existing ? { webContents: existing } : { webPreferences: preferences },
    );
    const tab: Tab = {
      id: randomUUID(),
      view,
      requestedURL: "about:blank",
      error: null,
      preview: null,
      device: { enabled: false, width: 390, height: 844 },
      viewportKey: "",
      emulating: false,
      ready: false,
    };
    view.setBackgroundColor("#0a0a0a");
    view.setBounds({ x: 0, y: 0, width: 1100, height: 780 });
    browser.tabs.push(tab);
    browser.active = tab.id;
    const wc = view.webContents;
    wc.on("before-input-event", (event, input) => {
      const workspaceShortcut =
        (input.meta || input.control) && ["KeyB", "KeyL"].includes(input.code);
      if (
        input.type === "keyDown" &&
        !workspaceShortcut &&
        input.key !== "Escape" &&
        !automationInput.has(wc) &&
        interruptHumanInput(browser.id)
      )
        event.preventDefault();
    });
    wc.on("before-mouse-event", (event, input) => {
      if (
        ["mouseDown", "mouseWheel"].includes(input.type) &&
        !automationInput.has(wc) &&
        interruptHumanInput(browser.id)
      )
        event.preventDefault();
    });
    installWorkspaceShortcuts(window, wc);
    wc.on("dom-ready", () => {
      tab.ready = true;
      tab.viewportKey = "";
      layoutPreview(tab);
      publish(browser);
    });
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
    const changed = () => {
      if (tab.preview && !tab.preview.isDestroyed())
        tab.preview.setTitle(`${wc.getTitle() || "Browser"} — awl preview`);
      publish(browser);
    };
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
      tab.ready = false;
      tab.emulating = false;
      tab.viewportKey = "";
      tab.error = "This tab stopped responding. Reload to try again.";
      publish(browser);
    });
    wc.on("destroyed", () => {
      if (!disposed && browser.tabs.includes(tab))
        removeTab(browser, tab, false);
    });
    wc.on("before-input-event", (event, input) => {
      if (input.key === "Escape" && !tab.preview)
        window.webContents.send("browser:exit-fullscreen");
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
  ipcMain.handle(
    "browser:command",
    async (event, input: unknown): Promise<BrowserResult> => {
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
        if (
          !["get", "options"].includes(String(input.action)) &&
          interruptHumanInput(browser.id)
        )
          throw new Error(
            "Agent paused. You’re in control; try the browser action again.",
          );
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
            await browserTool(browser, tab, input as BrowserCommand);
        }
        publish(browser);
        return { state: state(browser) };
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : "Browser request failed.",
        };
      }
    },
  );
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
  const themeChanged = () => {
    for (const browser of browsers.values()) publish(browser);
  };
  nativeTheme.on("updated", themeChanged);
  window.on("resize", layout);
  window.on("closed", () => {
    disposed = true;
    app.removeListener("before-quit", beforeQuit);
    nativeTheme.removeListener("updated", themeChanged);
    for (const channel of [
      "browser:command",
      "browser:present",
      "browser:hide",
    ])
      ipcMain.removeHandler(channel);
    for (const browser of browsers.values())
      for (const tab of browser.tabs) {
        if (tab.preview) returnToWorkspace(browser, tab);
        if (!tab.view.webContents.isDestroyed())
          tab.view.webContents.close({ waitForBeforeUnload: false });
      }
    browsers.clear();
  });
  function target(agentId: string, tabId: string) {
    if (disposed)
      throw new ToolError("SESSION_CLOSED", "The browser session has closed.");
    const tab = browsers.get(agentId)?.tabs.find((item) => item.id === tabId);
    if (!tab || tab.view.webContents.isDestroyed())
      throw new ToolError(
        "TAB_NOT_FOUND",
        "List this chat’s tabs to get a current tab ID.",
      );
    return tab;
  }
  return {
    onHumanInput: (handler) => {
      humanInput = handler;
    },
    setOwner: (id, owner) => {
      owners.set(id, owner);
    },
    target: (agentId, tabId) => target(agentId, tabId).view.webContents,
    tabs(agentId, action, tabId) {
      const browser = getBrowser(agentId);
      if (action !== "list") {
        if (!tabId)
          throw new ToolError("INVALID_ARGUMENTS", "A tab ID is required.");
        const tab = target(agentId, tabId);
        if (action === "select") browser.active = tab.id;
        else removeTab(browser, tab);
        publish(browser);
      }
      return state(browser);
    },
    async start(agentId, rawURL, tabId, signal) {
      let url: string;
      try {
        url = normalizeURL(rawURL);
      } catch {
        throw new ToolError(
          "INVALID_URL",
          "Use an HTTP or HTTPS URL without embedded credentials.",
        );
      }
      signal.throwIfAborted();
      const browser = getBrowser(agentId);
      const tab = tabId
        ? target(agentId, tabId)
        : (browser.tabs.find((item) => item.requestedURL === "about:blank") ??
          createTab(browser));
      browser.active = tab.id;
      const wc = tab.view.webContents;
      const stop = () => {
        if (!wc.isDestroyed()) wc.stop();
      };
      signal.addEventListener("abort", stop, { once: true });
      try {
        await load(browser, tab, url);
        signal.throwIfAborted();
        if (wc.isDestroyed())
          throw new ToolError(
            "TAB_NOT_FOUND",
            "The tab closed during navigation.",
          );
        if (
          tab.error ||
          (wc.getURL() === "about:blank" && url !== "about:blank")
        )
          throw new ToolError(
            "NAVIGATION_FAILED",
            "The page could not be loaded. Inspect tabs before retrying.",
          );
        return state(browser);
      } finally {
        signal.removeEventListener("abort", stop);
      }
    },
  };
}
