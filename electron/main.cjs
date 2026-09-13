const { app, BrowserWindow, Menu } = require("electron");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const { parseEnv } = require("node:util");
const { BrowserPolicy } = require("../dist-electron/electron/policy.cjs");
const { PolicyStore } = require("../dist-electron/electron/policy-store.cjs");
const { installBrowser } = require("../dist-electron/electron/browser.cjs");
const { installAgent } = require("../dist-electron/electron/agent-ipc.cjs");

const {
  installWorkspaceShortcuts,
} = require("../dist-electron/electron/workspace-shortcuts.cjs");

app.setName("awl");
const iconPath = path.join(__dirname, "assets", "awl.png");

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0a0a0a",
    title: "awl",
    icon: iconPath,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 20, y: 20 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  installWorkspaceShortcuts(window, window.webContents);
  let local = {};
  try {
    local = parseEnv(readFileSync(path.join(app.getAppPath(), ".env"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const policyFile = process.env.AWL_POLICY_FILE || local.AWL_POLICY_FILE;
  const policies = new PolicyStore(
    policyFile
      ? path.resolve(app.getAppPath(), policyFile)
      : path.join(app.getPath("userData"), "policy.json"),
    Boolean(policyFile),
  );
  const browser = installBrowser(
    window,
    new BrowserPolicy(policies.read().config),
  );
  installAgent(window, browser, policies);
  const developmentUrl = process.env.AWL_DEV_URL;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.once("ready-to-show", () => window.show());
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
      throw new Error("Invalid development origin");
    window.loadURL(url.href);
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  app.dock?.setIcon(iconPath);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
