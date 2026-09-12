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
  if (req.url === "/sensitive") {
    res.end('<input type="password" value="fixture-secret">');
    return;
  }
  if (req.url === "/framed") {
    res.end(
      '<h1>Frames</h1><iframe src="/" style="width:600px;height:400px"></iframe>',
    );
    return;
  }
  if (req.url === "/shadow") {
    res.end(
      `<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<label for="shadow">Shadow input</label><input id="shadow">';</script>`,
    );
    return;
  }
  if (req.url === "/shadow-secret") {
    res.end(
      `<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<input type="password" value="fixture-secret">';</script>`,
    );
    return;
  }

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
  assert.equal(
    (
      await call("browser-wait", "browserWait", {
        tab_id: tabId,
        condition: "text",
        contains: "Ada",
        timeout_ms: 1000,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await call("browser-wait", "browserWait", {
        tab_id: tabId,
        condition: "text",
        contains: "not-here",
        timeout_ms: 100,
      })
    ).error.code,
    "CONDITION_TIMEOUT",
  );

  // References cannot silently switch to replacement nodes.
  const beforeReplace = await inspect();
  await app.evaluate(
    async (_, tabId) =>
      globalThis.awlToolsTest.browser
        .target("test", tabId)
        .executeJavaScript(
          'const old = document.querySelector("#name"); old.replaceWith(old.cloneNode(true));',
        ),
    tabId,
  );
  assert.equal(
    (
      await call("browser-action", "browserAction", {
        ...actionArgs,
        snapshot_id: beforeReplace.data.snapshot_id,
        ref: beforeReplace.data.elements.find((el) => el.selector === "#name")
          .ref,
      })
    ).error.code,
    "STALE_ELEMENT",
  );
  await call("browser-start", "browserStart", {
    url: `${base}/framed`,
    tab_id: tabId,
  });
  const parent = await inspect();
  assert.equal(parent.ok, true, JSON.stringify(parent));
  assert.equal(parent.data.frames.length, 2);
  const child = await call("browser-dom", "browserDom", {
    tab_id: tabId,
    frame_id: parent.data.frames[1].id,
    offset: 0,
    limit: 100,
  });
  assert.ok(child.data.elements.some((el) => el.name === "Name"));
  await call("browser-start", "browserStart", {
    url: `${base}/shadow`,
    tab_id: tabId,
  });
  const shadow = await inspect();
  assert.ok(shadow.data.elements.some((el) => el.name === "Shadow input"));
  for (const path of ["sensitive", "shadow-secret"]) {
    await call("browser-start", "browserStart", {
      url: `${base}/${path}`,
      tab_id: tabId,
    });
    assert.equal((await inspect()).error.code, "SENSITIVE_PAGE");
    const blockedCapture = await call(
      "browser-screenshot",
      "browserScreenshot",
      { tab_id: tabId },
    );
    assert.equal(blockedCapture.error.code, "SENSITIVE_PAGE");
    assert.equal(blockedCapture.image, undefined);
  }
  console.log(
    "Passed: browser tools, real fill/click, stale refs, frames, shadow roots, sensitive capture blocks, waits, and chat isolation.",
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
