import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";

const server = createServer((req, res) => {
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
    "<style>body{font:16px system-ui;background:#f5f1e8;color:#202a25;padding:40px}input,button,a{display:block;margin:18px 0;padding:12px}input{width:75%}button{cursor:pointer}small{color:#617369}</style>";
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
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWL_DEV_URL;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: ["."],
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
    window.hide();
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
  const attached = () =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window.contentView.children
        .filter(
          (view) => view.webContents && view.webContents !== window.webContents,
        )
        .map((view) => ({
          id: view.webContents.id,
          bounds: view.getBounds(),
          url: view.webContents.getURL(),
        }));
    });
  const waitAttached = async (count) => {
    for (let i = 0; i < 100; i++) {
      if ((await attached()).length === count) return;
      await page.waitForTimeout(30);
    }
    assert.equal((await attached()).length, count);
  };
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
  await guest.getByRole("button", { name: "Save locally" }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
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
  await page.getByRole("button", { name: "Capability", exact: true }).click();
  await waitAttached(0);
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  await waitAttached(1);
  assert.equal(
    await guest.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Keep this form alive",
  );

  // The native view follows panel dividers and window dimensions in DIP coordinates.
  await page
    .getByRole("separator", { name: "Resize browser panel" })
    .press("ArrowLeft");
  await page.waitForTimeout(100);
  const surface = await page.locator(".browser-surface").boundingBox();
  const bounds = (await attached())[0].bounds;
  for (const key of ["x", "y", "width", "height"])
    assert.ok(Math.abs(surface[key] - bounds[key]) <= 1, `${key} mismatch`);
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
  await popup.getByRole("button", { name: "Finish sign in" }).click();
  await guest.getByText("signed in", { exact: true }).waitFor();
  assert.ok(
    (await guest.evaluate(() => document.cookie)).includes("signed_in=yes"),
  );
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);

  // Another agent receives an isolated cookie/storage context.
  await page
    .getByRole("button", { name: "Statement lookup Completed", exact: true })
    .click();
  await page.getByRole("heading", { name: "Where are we going?" }).waitFor();
  await navigate(`${base}/two`);
  const other = await guestPage(`${base}/two`);
  await other
    .getByRole("heading", { name: "Second page", exact: true })
    .waitFor();
  assert.equal(await other.evaluate(() => document.cookie), "");
  assert.equal(await other.evaluate(() => localStorage.getItem("saved")), null);
  await page
    .getByRole("button", { name: "Member onboarding Needs you", exact: true })
    .click();
  await waitAttached(1);
  assert.equal((await attached())[0].id, originalId);
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await page
    .getByRole("button", { name: "Resume with awl", exact: true })
    .click();
  assert.equal((await attached())[0].id, originalId);

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
  assert.deepEqual(errors, []);
  console.log(
    "Passed: real browsing, form preservation, navigation/history/reload, native bounds, overview/capability/collapse, popup authentication, session isolation, URL validation, load recovery, renderer reload, tab lifecycle.",
  );
} catch (error) {
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
