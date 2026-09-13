import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";
const directory = await mkdtemp(join(tmpdir(), "awl-tools-"));
const sensitiveFixtures = {
  otp: '<input name="otp" value="fixture-secret">',
  card: '<label for="card">Card number</label><input id="card" inputmode="numeric" value="fixture-secret">',
  camel: '<input name="creditCardNumber" value="fixture-secret">',
  aria: '<span id="hint">Security code</span><input aria-labelledby="hint" value="fixture-secret">',
  placeholder: '<input placeholder="Verification code" value="fixture-secret">',
  autocomplete:
    '<input autocomplete="section-checkout billing CC-NUMBER" value="fixture-secret">',
  pin: '<input aria-label="PIN" value="fixture-secret">',
  split:
    '<fieldset><legend>One-time code</legend><input inputmode="numeric" maxlength="1" value="1"><input inputmode="numeric" maxlength="1" value="2"></fieldset>',
  editable:
    '<div role="textbox" contenteditable="true" aria-label="Card number">fixture-secret</div>',
  "semantic-shadow": `<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<span id="hint">CVV</span><input aria-labelledby="hint" value="fixture-secret">';</script>`,
  "semantic-frame": '<iframe src="/otp"></iframe>',
};
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const fixture = sensitiveFixtures[req.url.slice(1)];
  if (fixture) {
    res.end(fixture);
    return;
  }
  if (req.url === "/covered") {
    res.end(
      '<button style="position:absolute;left:20px;top:20px;width:100px;height:40px">Covered</button><div style="position:absolute;left:20px;top:20px;width:100px;height:40px;z-index:2">Overlay</div>',
    );
    return;
  }
  if (req.url === "/fields") {
    res.end(
      `<textarea id="random_${Date.now()}" name="q" role="combobox" aria-label="Search" onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('#result').textContent=this.value}">old query</textarea><input aria-label="Quantity" type="number" value="42"><input aria-label="Rejected" oninput="this.value=''"><input aria-label="Focus trap" onfocus="document.querySelector('[name=q]').focus()"><p id="result"></p>`,
    );
    return;
  }
  if (req.url === "/targets") {
    res.end(
      `<input placeholder="Search a paper"><button>Search</button><button>Duplicate</button><button>Duplicate</button><div id="host"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML='<input placeholder="Shadow search">';</script>`,
    );
    return;
  }
  if (req.url === "/ordinary-numeric") {
    res.end(
      '<label>Quantity<input inputmode="numeric" value="4"></label><label>Postal code<input inputmode="numeric" value="10001"></label><input name="otp" type="hidden" value="fixture-secret">',
    );
    return;
  }
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
  await app.evaluate(() => {
    globalThis.nativeInterruptions = 0;
    globalThis.awlToolsTest.browser.onHumanInput((id) => {
      globalThis.nativeInterruptions++;
      globalThis.awlToolsTest.browser.setOwner(id, "human");
    });
    globalThis.awlToolsTest.browser.setOwner("test", "agent");
  });
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
  for (const path of [
    "sensitive",
    "shadow-secret",
    ...Object.keys(sensitiveFixtures),
  ]) {
    await call("browser-start", "browserStart", {
      url: `${base}/${path}`,
      tab_id: tabId,
    });
    assert.equal((await inspect()).error.code, "SENSITIVE_PAGE", path);
    const blockedCapture = await call(
      "browser-screenshot",
      "browserScreenshot",
      { tab_id: tabId },
    );
    assert.equal(blockedCapture.error.code, "SENSITIVE_PAGE", path);
    assert.equal(blockedCapture.image, undefined);
  }
  await call("browser-start", "browserStart", {
    url: `${base}/ordinary-numeric`,
    tab_id: tabId,
  });
  assert.equal(
    (await inspect()).ok,
    true,
    "ordinary numeric fields are observable",
  );
  assert.equal(
    (await call("browser-screenshot", "browserScreenshot", { tab_id: tabId }))
      .ok,
    true,
  );
  await call("browser-start", "browserStart", {
    url: `${base}/targets`,
    tab_id: tabId,
  });
  const targets = await inspect();
  const searchTarget = targets.data.elements.find(
    (el) => el.name === "Search a paper",
  ).target;
  const shadowTarget = targets.data.elements.find(
    (el) => el.name === "Shadow search",
  ).target;
  assert.equal(searchTarget.kind, "placeholder");
  assert.deepEqual(shadowTarget.shadow, ["#host"]);
  const resolve = (target) =>
    app.evaluate(
      async (_, { target, tabId }) => {
        const { resolveTarget } = globalThis.awlToolsTest;
        try {
          return await resolveTarget(
            globalThis.awlToolsTest.browser.target("test", tabId),
            target,
          );
        } catch (error) {
          return { error: error.code };
        }
      },
      { target, tabId },
    );
  assert.ok((await resolve(searchTarget)).snapshot_id);
  assert.ok((await resolve(shadowTarget)).snapshot_id);
  assert.equal(
    (
      await resolve({
        ...searchTarget,
        kind: "role",
        role: "button",
        value: "Duplicate",
      })
    ).error,
    "AMBIGUOUS_TARGET",
  );
  await call("browser-start", "browserStart", {
    url: `${base}/targets`,
    tab_id: tabId,
  });
  assert.ok(
    (await resolve(searchTarget)).snapshot_id,
    "semantic target survives reload",
  );
  await call("browser-start", "browserStart", {
    url: `${base}/covered`,
    tab_id: tabId,
  });
  const covered = await inspect();
  const coveredClick = await call("browser-action", "browserAction", {
    tab_id: tabId,
    frame_id: covered.data.frame_id,
    snapshot_id: covered.data.snapshot_id,
    ref: covered.data.elements.find((el) => el.name === "Covered").ref,
    action: "click",
    value: null,
  });
  assert.equal(coveredClick.error.code, "OBSCURED_ELEMENT");
  await call("browser-start", "browserStart", {
    url: `${base}/fields`,
    tab_id: tabId,
  });
  const fieldAction = async (name, action, value) => {
    const dom = await inspect();
    return call("browser-action", "browserAction", {
      tab_id: tabId,
      frame_id: dom.data.frame_id,
      snapshot_id: dom.data.snapshot_id,
      ref: dom.data.elements.find((e) => e.name === name).ref,
      action,
      value,
    });
  };
  const fields = await inspect();
  const queryTarget = fields.data.elements.find(
    (e) => e.name === "Search",
  ).target;
  assert.equal(queryTarget.value, 'textarea[name="q"]');
  const typed = await fieldAction("Search", "fill", "NFL Sunday Ticket");
  assert.equal(typed.ok, true, JSON.stringify(typed));
  assert.equal(typed.data.value_verified, true);
  assert.equal((await fieldAction("Search", "press", "Enter")).ok, true);
  assert((await inspect()).data.text.includes("NFL Sunday Ticket"));
  assert.equal((await fieldAction("Search", "fill", "")).ok, true);
  assert.equal((await fieldAction("Quantity", "fill", "7")).ok, true);
  assert.equal(
    (await fieldAction("Rejected", "fill", "not retained")).error.code,
    "FIELD_VALUE_CHANGED",
  );
  assert.equal(
    (await fieldAction("Focus trap", "fill", "wrong field")).error.code,
    "FOCUS_FAILED",
  );
  await call("browser-start", "browserStart", {
    url: `${base}/fields`,
    tab_id: tabId,
  });
  assert.equal(
    (await resolve(queryTarget)).inputValue,
    "old query",
    "named target survives regenerated IDs",
  );
  await app.evaluate(() =>
    globalThis.awlToolsTest.browser.setAccess("test", "read_only"),
  );
  assert.equal(
    (await fieldAction("Search", "fill", "blocked")).error.code,
    "POLICY_DENIED",
  );
  assert.equal(
    (await fieldAction("Search", "press", "Enter")).error.code,
    "POLICY_DENIED",
  );
  assert.equal(
    (await resolve(queryTarget)).inputValue,
    "old query",
    "read-only blocks typing before touching the field",
  );
  await call("browser-start", "browserStart", {
    url: `${base}/fields`,
    tab_id: tabId,
  });
  assert.equal(
    (await fieldAction("Search", "fill", "still blocked")).error.code,
    "POLICY_DENIED",
  );
  await app.evaluate(() =>
    globalThis.awlToolsTest.browser.setAccess("test", "configured"),
  );
  assert.equal((await fieldAction("Search", "fill", "allowed again")).ok, true);
  assert.equal(
    await app.evaluate(() => globalThis.nativeInterruptions),
    0,
    "automation input must not trigger human takeover",
  );
  await app.evaluate((_, tabId) => {
    const wc = globalThis.awlToolsTest.browser.target("test", tabId);
    wc.sendInputEvent({ type: "keyDown", keyCode: "A" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "A" });
  }, tabId);
  assert.equal(
    await app.evaluate(() => globalThis.nativeInterruptions),
    1,
    "native input interrupts agent ownership",
  );
  console.log(
    "Passed: browser tools, real fill/click, stale refs, frames, shadow roots, sensitive capture blocks, waits, and chat isolation.",
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
