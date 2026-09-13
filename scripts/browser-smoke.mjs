import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { _electron as electron } from "playwright-core";
import { prepareElectron, testElectronArgs } from "./electron-runtime.mjs";

let cacheRequests = 0;
const server = createServer((req, res) => {
  if (req.url === "/cached") {
    res.writeHead(200, {
      "content-type": "text/plain",
      "cache-control": "max-age=3600",
    });
    res.end(String(++cacheRequests));
    return;
  }
  if (req.url === "/broken") {
    req.socket.destroy();
    return;
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
  });
  const style =
    '<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px system-ui;background:#f5f1e8;color:#202a25;padding:40px}input,button,a{display:block;margin:18px 0;padding:12px}input{width:75%}button{cursor:pointer}small{color:#617369}</style>';
  if (req.url === "/auth")
    res.end(
      `${style}<title>Sign in</title><h1>Local sign in</h1><button onclick="document.cookie='signed_in=yes;path=/';window.opener.postMessage('signed in',location.origin);window.close()">Finish sign in</button>`,
    );
  else if (req.url === "/two")
    res.end(
      `${style}<title>Second page</title><h1>Second page</h1><a href='/one'>First page</a>`,
    );
  else
    res.end(
      `${style}<title>Browser test workspace</title><small>AWL · LOCAL BROWSER TEST</small><h1>A real browser, beside your agent.</h1><label>Notes<input aria-label='Notes' id='notes' placeholder='Type something here'></label><button onclick="document.cookie='session=onboarding;path=/';localStorage.setItem('saved','yes');document.querySelector('#saved').textContent='Saved'">Save locally</button><p id='saved'></p><a href='/two'>Next page</a><button onclick="window.open('/auth','signin')">Sign in popup</button><p id='auth'></p><script>addEventListener('message',event=>{if(event.origin===location.origin)document.querySelector('#auth').textContent=event.data})</script>`,
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, AWL_AI_DISABLED: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWL_DEV_URL;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: testElectronArgs(["."]),
  env,
});
try {
  const page = await app.firstWindow();
  app.context().setDefaultTimeout(15000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("textbox", { name: "Website address" }).waitFor();
  await app.evaluate(({ app, BrowserWindow }) => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    const window = BrowserWindow.getAllWindows()[0];
    window.removeAllListeners("ready-to-show");
    if (process.env.CI) window.show();
    else window.hide();
    window.webContents.setBackgroundThrottling(false);
  });
  const address = page.getByRole("textbox", { name: "Website address" });
  const navigate = async (url) => {
    await address.fill(url);
    await address.press("Enter");
  };
  const guestPage = async (url) => {
    for (let i = 0; i < 150; i++) {
      const found = app
        .context()
        .pages()
        .find((candidate) => candidate !== page && candidate.url() === url);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `No guest page for ${url}. Pages: ${app
        .context()
        .pages()
        .map((page) => page.url())}`,
    );
  };
  const mainWindowId = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
  );
  const attached = () =>
    app.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id);
      return window.contentView.children
        .filter(
          (view) => view.webContents && view.webContents !== window.webContents,
        )
        .map((view) => ({
          id: view.webContents.id,
          bounds: view.getBounds(),
          url: view.webContents.getURL(),
        }));
    }, mainWindowId);
  const waitAttached = async (count) => {
    for (let i = 0; i < 100; i++) {
      if ((await attached()).length === count) return;
      await page.waitForTimeout(30);
    }
    assert.equal((await attached()).length, count);
  };
  const waitGeometry = async () => {
    let surface, bounds;
    const geometryDeadline = Date.now() + 10000;
    do {
      surface = await page.locator(".browser-surface").boundingBox();
      bounds = (await attached())[0].bounds;
      if (
        ["x", "y", "width", "height"].every(
          (key) => Math.abs(surface[key] - bounds[key]) <= 1,
        )
      )
        break;
      await page.waitForTimeout(100);
    } while (Date.now() < geometryDeadline);
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(surface[key] - bounds[key]) <= 1,
        `${key} mismatch: surface=${JSON.stringify(surface)}, native=${JSON.stringify(bounds)}`,
      );
    return { surface, bounds };
  };
  await page.getByRole("button", { name: "New agent", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".new-agent").disabled,
  );
  const firstAgentId = (await page.evaluate(() => window.awlAgent.state()))
    .chats[0].id;
  await navigate(`${base}/one`);
  const guest = await guestPage(`${base}/one`);
  await guest
    .getByRole("heading", { name: "A real browser, beside your agent." })
    .waitFor();
  await waitAttached(1);
  const originalId = (await attached())[0].id;
  assert.deepEqual(
    await guest.evaluate(() => [
      typeof window.awlBrowser,
      typeof require,
      typeof process,
    ]),
    ["undefined", "undefined", "undefined"],
  );
  await guest
    .getByRole("textbox", { name: "Notes" })
    .fill("Keep this form alive");
  // Workspace shortcuts still reach the shell while native web content has focus.
  const guestShortcut = async (alt = false) =>
    app.evaluate(
      ({ webContents }, { id, alt }) => {
        const wc = webContents.fromId(id);
        wc.focus();
        const modifiers = [
          process.platform === "darwin" ? "meta" : "control",
          ...(alt ? ["alt"] : []),
        ];
        wc.sendInputEvent({ type: "keyDown", keyCode: "B", modifiers });
        wc.sendInputEvent({ type: "keyUp", keyCode: "B", modifiers });
      },
      { id: originalId, alt },
    );
  await guestShortcut();
  await page
    .getByRole("button", { name: "Show sidebar", exact: true })
    .waitFor();
  await guestShortcut();
  await page
    .getByRole("button", { name: "Hide sidebar", exact: true })
    .waitFor();
  await guestShortcut(true);
  await page
    .getByRole("button", { name: "Show browser", exact: true })
    .waitFor();
  await waitAttached(0);
  await page.getByRole("button", { name: "Show browser", exact: true }).click();
  await waitAttached(1);
  assert.equal(
    await guest.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Keep this form alive",
  );
  await guest.getByRole("button", { name: "Save locally" }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await waitAttached(0);
  await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
  await page
    .getByRole("heading", { name: "Capabilities", exact: true })
    .waitFor();
  await waitAttached(0);
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);
  assert.equal(
    await guest.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Keep this form alive",
  );
  await page.getByRole("button", { name: "Hide browser", exact: true }).click();
  await waitAttached(0);
  await page.getByRole("button", { name: "Show browser", exact: true }).click();
  await waitAttached(1);
  // The native view follows panel dividers and window dimensions in DIP coordinates.
  await page
    .getByRole("separator", { name: "Resize browser panel" })
    .press("ArrowLeft");
  await waitGeometry();
  await guest.getByRole("link", { name: "Next page" }).click();
  await guest
    .getByRole("heading", { name: "Second page", exact: true })
    .waitFor();
  await page.waitForFunction(
    (url) =>
      document.querySelector('[aria-label="Website address"]').value === url,
    `${base}/two`,
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await guest.waitForURL(`${base}/one`);
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await guest.waitForURL(`${base}/two`);
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await guest
    .getByRole("heading", { name: "Second page", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await guest.waitForURL(`${base}/one`);

  // Native popup relationships survive inside tabs (including auth postMessage).
  await guest.getByRole("button", { name: "Sign in popup" }).click();
  const popup = await guestPage(`${base}/auth`);
  // The handler closes its own native tab. CDP may report that closure before
  // acknowledging the click; verify the opener message and cookie below.
  await popup
    .getByRole("button", { name: "Finish sign in" })
    .click({ noWaitAfter: true })
    .catch((error) => {
      if (!popup.isClosed() || !error.message.includes("has been closed"))
        throw error;
    });
  await guest.getByText("signed in", { exact: true }).waitFor();
  assert.ok(
    (await guest.evaluate(() => document.cookie)).includes("signed_in=yes"),
  );
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);

  // Another agent receives an isolated cookie/storage context.
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".agent-item").length === 2,
  );
  await page.getByRole("heading", { name: "Where are we going?" }).waitFor();
  await navigate(`${base}/two`);
  const other = await guestPage(`${base}/two`);
  await other
    .getByRole("heading", { name: "Second page", exact: true })
    .waitFor();
  assert.equal(await other.evaluate(() => document.cookie), "");
  assert.equal(await other.evaluate(() => localStorage.getItem("saved")), null);
  // New sessions are first; return to the older session and its original tab.
  assert.equal(
    await page.locator(".agent-item").first().getAttribute("aria-current"),
    "page",
  );
  await page.locator(".agent-item").last().click();
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);

  // Exercise the real native menu callbacks without leaving an OS menu open.
  const openOptions = async () => {
    await app.evaluate(({ Menu }) => {
      const original = Menu.prototype.popup;
      Menu.prototype.popup = function () {
        globalThis.awlTestMenu = this;
        Menu.prototype.popup = original;
      };
    });
    await page
      .getByRole("button", { name: "Browser options", exact: true })
      .click();
  };
  const menuAction = async (id) => {
    await openOptions();
    await app.evaluate((_electron, id) => {
      const item = globalThis.awlTestMenu.getMenuItemById(id);
      if (!item) throw new Error(`Missing menu item: ${id}`);
      item.click();
    }, id);
  };
  const browserState = () =>
    page.evaluate(
      async (agentId) =>
        (
          await window.awlBrowser.command({
            action: "get",
            agentId,
          })
        ).state,
      firstAgentId,
    );
  await openOptions();
  const labels = await app.evaluate(() =>
    globalThis.awlTestMenu.items.map((item) => item.label),
  );
  for (const label of [
    "Hard reload",
    "Open DevTools",
    "Open separate preview window",
    "Show device toolbar",
    "Appearance",
    "Clear cookies",
    "Clear cache",
  ])
    assert.ok(labels.includes(label), `Missing browser option: ${label}`);
  await guest
    .getByRole("textbox", { name: "Notes" })
    .fill("Same tab, more room");
  await page.getByRole("button", { name: "Enter browser fullscreen" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".browser-panel").getBoundingClientRect().width ===
      innerWidth,
  );
  const { surface: fullscreenSurface } = await waitGeometry();
  assert.ok(
    Math.abs((await attached())[0].bounds.width - fullscreenSurface.width) <= 1,
  );
  assert.ok(
    fullscreenSurface.width > (await page.evaluate(() => innerWidth)) * 0.9,
  );
  assert.equal((await attached())[0].id, originalId);
  // CDP keyboard events bypass Electron's native before-input-event hook.
  await app.evaluate(({ BrowserWindow, webContents }, id) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    window.focus();
    const wc = webContents.fromId(id);
    wc.focus();
    wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  }, originalId);
  await page
    .getByRole("button", { name: "Enter browser fullscreen" })
    .waitFor();
  assert.equal(
    await guest.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Same tab, more room",
  );

  await menuAction("preview");
  await page
    .getByRole("heading", { name: "Open in a separate window." })
    .waitFor();
  await waitAttached(0);
  const previewCount = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((win) =>
        win.getTitle().endsWith("awl preview"),
      ).length,
  );
  assert.equal(previewCount, 1);
  await guest
    .getByRole("textbox", { name: "Notes" })
    .fill("Still the same page");
  // Closing the preview window docks the live contents instead of destroying it.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle().endsWith("awl preview"))
      .close(),
  );
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);
  assert.equal(
    await guest.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Still the same page",
  );

  await menuAction("device");
  await page.getByRole("form", { name: "Device toolbar" }).waitFor();
  await guest.waitForFunction(() => innerWidth === 390);
  await page.getByRole("button", { name: "Rotate viewport" }).click();
  await guest.waitForFunction(() => innerWidth === 844);
  await page
    .getByRole("combobox", { name: "Device preset" })
    .selectOption("Tablet");
  await guest.waitForFunction(() => innerWidth === 768);
  // Native emulation updates before the shell receives and renders its snapshot.
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Viewport width"]').value === "768" &&
      document.querySelector('[aria-label="Viewport height"]').value === "1024",
  );
  await page.getByRole("spinbutton", { name: "Viewport width" }).fill("600");
  await page.getByRole("spinbutton", { name: "Viewport height" }).fill("900");
  await page.getByRole("button", { name: "Apply viewport size" }).click();
  await guest.waitForFunction(() => innerWidth === 600);
  await page.getByRole("button", { name: "Hide device toolbar" }).click();
  await page.waitForFunction(() => !document.querySelector(".device-toolbar"));

  await menuAction("zoom-in");
  const activeZoom = async () => {
    const state = await browserState();
    return state.tabs.find((tab) => tab.id === state.activeTabId).zoom;
  };
  assert.equal(Math.round((await activeZoom()) * 100), 110);
  await menuAction("zoom-reset");
  assert.equal(await activeZoom(), 1);
  await guest.emulateMedia({ colorScheme: null });
  await menuAction("appearance-dark");
  await guest.waitForFunction(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  await menuAction("appearance-light");
  await guest.waitForFunction(
    () => matchMedia("(prefers-color-scheme: light)").matches,
  );
  await menuAction("appearance-system");
  await app.evaluate(({ webContents }, id) => {
    const wc = webContents.fromId(id);
    globalThis.devtoolsOpened = false;
    wc.once("devtools-opened", () => {
      globalThis.devtoolsOpened = true;
    });
  }, originalId);
  await menuAction("devtools");
  const devtoolsDeadline = Date.now() + 15000;
  while (Date.now() < devtoolsDeadline) {
    if (await app.evaluate(() => globalThis.devtoolsOpened)) break;
    await page.waitForTimeout(100);
  }
  assert.equal(
    await app.evaluate(() => globalThis.devtoolsOpened),
    true,
    "DevTools must finish opening",
  );
  assert.equal(
    await app.evaluate(
      ({ webContents }, id) => webContents.fromId(id).isDevToolsOpened(),
      originalId,
    ),
    true,
  );
  await app.evaluate(
    ({ webContents }, id) => webContents.fromId(id).closeDevTools(),
    originalId,
  );
  await menuAction("hard-reload");
  await guest.waitForFunction(
    () => document.querySelector("#notes")?.value === "",
  );
  await other.evaluate(() => {
    document.cookie = "peer=keep;path=/";
  });
  await menuAction("clear-cookies");
  await guest.waitForFunction(() => document.cookie === "");
  assert.ok(
    (await other.evaluate(() => document.cookie)).includes("peer=keep"),
  );
  assert.equal(
    await guest.evaluate(() => localStorage.getItem("saved")),
    "yes",
  );
  const cached = () =>
    guest.evaluate(() => fetch("/cached").then((response) => response.text()));
  assert.equal(await cached(), "1");
  assert.equal(await cached(), "1");
  await menuAction("clear-cache");
  await page.getByText("Cache cleared for this agent.").waitFor();
  assert.equal(await cached(), "2");

  // Reject privileged URL schemes, recover from a failed load, retain sessions on shell reload.
  await navigate("file:///etc/passwd");
  await page
    .getByText("Use an HTTP or HTTPS address without embedded credentials.")
    .waitFor();
  assert.equal(guest.url(), `${base}/one`);
  await navigate(`${base}/broken`);
  await page
    .getByRole("heading", { name: "This page couldn’t open." })
    .waitFor();
  await waitAttached(0);
  await navigate(`${base}/one`);
  await guest
    .getByRole("heading", { name: "A real browser, beside your agent." })
    .waitFor();
  await guest
    .getByRole("textbox", { name: "Notes" })
    .fill("Still here after shell reload");
  await page.reload();
  await page.getByRole("textbox", { name: "Website address" }).waitFor();
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);
  assert.equal(
    await guest.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Still here after shell reload",
  );
  await page
    .getByRole("button", { name: "New browser tab", exact: true })
    .click();
  await waitAttached(0);
  await page
    .getByRole("button", { name: "Close New tab", exact: true })
    .click();
  await waitAttached(1);
  await page.waitForFunction(
    () => document.querySelectorAll(".browser-tab").length === 1,
  );
  await page.waitForFunction(
    (url) =>
      document.querySelector('[aria-label="Website address"]').value === url,
    `${base}/one`,
  );
  await mkdir("test-results", { recursive: true });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  // Let the native surfaces paint after the otherwise hidden test run.
  await page.waitForTimeout(250);
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(
    "test-results/awl-live-browser.png",
    Buffer.from(screenshot, "base64"),
  );
  // BrowserWindow.capturePage captures the shell renderer; the native guest is
  // a separate surface, so keep its rendered-page evidence alongside the shell.
  await guest.screenshot({ path: "test-results/awl-live-site.png" });
  await menuAction("preview");
  await page
    .getByRole("heading", { name: "Open in a separate window." })
    .waitFor();
  // The finally block must also quit cleanly with a detached preview open.
  assert.deepEqual(errors, []);
  console.log(
    "Passed: real browsing, form preservation, navigation/history/reload, native bounds, overview/capability/collapse, popup authentication, session isolation, URL validation, load recovery, renderer reload, tab lifecycle, fullscreen, device sizing, preview reattachment, DevTools, appearance, zoom, cookie/cache controls.",
  );
} catch (error) {
  console.error(error);
  console.error(
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .map((wc) => ({ id: wc.id, url: wc.getURL(), type: wc.getType() })),
    ),
  );
  const shell = await app.firstWindow();
  console.error(await shell.locator(".live-browser").innerText());
  throw error;
} finally {
  await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
