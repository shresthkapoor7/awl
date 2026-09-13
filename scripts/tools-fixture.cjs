const { app, BrowserWindow } = require("electron");
const { installBrowser } = require("../dist-electron/electron/browser.cjs");
const { dispatch } = require("../dist-electron/electron/tools/core.cjs");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  const browser = installBrowser(window);
  globalThis.awlToolsTest = {
    browser,
    resolveTarget: require("../dist-electron/electron/targeting.cjs")
      .resolveTarget,
    call: (file, name, args, agentId = "test") =>
      dispatch(
        require(`../dist-electron/electron/tools/${file}.cjs`)[name],
        JSON.stringify(args),
        {
          agentId,
          browser,
          signal: AbortSignal.timeout(15000),
          rename: () => {},
          artifactDirectory: process.env.AWL_TEST_ARTIFACTS,
        },
      ),
  };
  await window.loadURL("about:blank");
});
