const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");
const { installBrowser } = require("../dist-electron/electron/browser.cjs");
const { dispatch } = require("../dist-electron/electron/tools/core.cjs");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.env.CI === "true",
    width: 1100,
    height: 780,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "../electron/preload.cjs"),
    },
  });
  const { BrowserPolicy } = require("../dist-electron/electron/policy.cjs");
  const policy = new BrowserPolicy({ destinations: [], actions: ["navigate", "click", "fill", "select", "press", "scroll"], safeControls: [], blockedControls: [] });
  const browser = installBrowser(window, policy);
  const present = (id) =>
    window.webContents.executeJavaScript(
      `window.awlBrowser.present(${JSON.stringify(id)}, "tool-fixture", {x:0,y:0,width:1000,height:700})`,
    );
  const start = browser.start.bind(browser);
  browser.start = async (...args) => {
    const url = new URL(args[1]);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
      policy.config.destinations.push({ origin: url.origin, paths: ["/*"] });
      policy.config.safeControls.push({ origin: url.origin, path: "/*", selector: "*", actions: ["click", "press"] });
    }
    const state = await start(...args);
    await present(args[0]);
    return state;
  };
  globalThis.awlToolsTest = {
    browser,
    AgentRuntime: require("../dist-electron/electron/agent-runtime.cjs")
      .AgentRuntime,
    Executor: require("../dist-electron/electron/executor.cjs"),
    Recorder: require("../dist-electron/electron/recorder.cjs").Recorder,
    resolveTarget: require("../dist-electron/electron/targeting.cjs")
      .resolveTarget,
    call: async (file, name, args, agentId = "test") => {
      await present(agentId);
      return dispatch(
        require(`../dist-electron/electron/tools/${file}.cjs`)[name],
        JSON.stringify(args),
        {
          agentId,
          browser,
          signal: AbortSignal.timeout(15000),
          rename: () => {},
          artifactDirectory: process.env.AWL_TEST_ARTIFACTS,
        },
      );
    },
  };
  await window.loadURL("about:blank");
});
