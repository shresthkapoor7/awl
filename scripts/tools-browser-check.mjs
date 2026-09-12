import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";
const directory = await mkdtemp(join(tmpdir(), "awl-tools-"));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<html><head><title>Tool fixture</title></head><body><h1>Workbench</h1><label for="name">Name</label><input id="name"><button onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Save</button><p id="result">Not saved</p><a href="/next">Next</a></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, AWL_TEST_ARTIFACTS: directory };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: [resolve("scripts/tools-fixture.cjs")],
  env,
});
try {
  await app.firstWindow();
  const call = (file, name, args, agentId = "test") =>
    app.evaluate(
      async (_, input) => globalThis.awlToolsTest.call(...input),
      [file, name, args, agentId],
    );
  const opened = await call("browser-start", "browserStart", {
    url: base,
    tab_id: null,
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const tabId = opened.data.activeTabId;
  assert.equal(opened.data.tabs[0].title, "Tool fixture");
  assert.equal(
    (
      await call("browser-start", "browserStart", {
        url: "file:///etc/passwd",
        tab_id: null,
      })
    ).error.code,
    "INVALID_URL",
  );
  assert.equal(
    (
      await call(
        "browser-start",
        "browserStart",
        { url: base, tab_id: tabId },
        "other",
      )
    ).error.code,
    "TAB_NOT_FOUND",
  );
  const listed = await call("browser-tabs", "browserTabs", {
    action: "list",
    tab_id: null,
  });
  assert.equal(listed.data.activeTabId, tabId);
  assert.equal(
    (
      await call("browser-tabs", "browserTabs", {
        action: "select",
        tab_id: "missing",
      })
    ).error.code,
    "TAB_NOT_FOUND",
  );
  assert.equal(
    (
      await call(
        "browser-tabs",
        "browserTabs",
        { action: "close", tab_id: tabId },
        "other",
      )
    ).error.code,
    "TAB_NOT_FOUND",
  );
  const capture = await call("browser-screenshot", "browserScreenshot", {
    tab_id: tabId,
  });
  assert.equal(capture.ok, true, JSON.stringify(capture));
  assert.ok(capture.image.startsWith("data:image/png;base64,iVBOR"));
  assert.ok(capture.data.image.width <= 1280);
  const dom = await call("browser-dom", "browserDom", {
    tab_id: tabId,
    frame_id: null,
    offset: 0,
    limit: 100,
  });
  assert.equal(dom.ok, true, JSON.stringify(dom));
  assert.ok(dom.data.text.includes("Workbench"));
  assert.ok(
    dom.data.elements.some(
      (el) => el.name === "Name" && el.selector === "#name",
    ),
  );
  const page2 = await call("browser-dom", "browserDom", {
    tab_id: tabId,
    frame_id: null,
    offset: 0,
    limit: 1,
  });
  assert.equal(page2.data.elements.length, 1);
  assert.equal(page2.data.next_offset, 1);
  const inspect = () =>
    call("browser-dom", "browserDom", {
      tab_id: tabId,
      frame_id: null,
      offset: 0,
      limit: 100,
    });
  const fresh = await inspect();
  const inputRef = fresh.data.elements.find((el) => el.name === "Name").ref;
  const actionArgs = {
    tab_id: tabId,
    frame_id: fresh.data.frame_id,
    snapshot_id: fresh.data.snapshot_id,
    ref: inputRef,
    action: "fill",
    value: "Ada",
  };
  assert.equal(
    (await call("browser-action", "browserAction", actionArgs)).ok,
    true,
  );
  assert.equal(
    (await call("browser-action", "browserAction", actionArgs)).error.code,
    "STALE_ELEMENT",
  );
  const afterFill = await inspect();
  const clicked = await call("browser-action", "browserAction", {
    ...actionArgs,
    snapshot_id: afterFill.data.snapshot_id,
    ref: afterFill.data.elements.find((el) => el.name === "Save").ref,
    action: "click",
    value: null,
  });
  assert.equal(clicked.ok, true, JSON.stringify(clicked));
  assert.ok((await inspect()).data.text.includes("Ada"));
  console.log(
    "Passed: local browser tool navigation, non-web URL rejection, cross-chat isolation.",
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
