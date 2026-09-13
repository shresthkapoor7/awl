import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    req.url === "/private"
      ? '<input name="otp" value="never-retain-this">'
      : '<input placeholder="Search papers"><button>Search</button>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: [resolve("scripts/tools-fixture.cjs")],
  env,
});
try {
  await app.firstWindow();
  await app.evaluate(async (_, base) => {
    const t = globalThis.awlToolsTest;
    const state = await t.browser.start(
      "record",
      base,
      null,
      AbortSignal.timeout(10000),
    );
    const wc = t.browser.target("record", state.activeTabId);
    if (wc.isLoading())
      await new Promise((resolve) => wc.once("did-stop-loading", resolve));
    globalThis.recordTab = state.activeTabId;
    globalThis.recorder = new t.Recorder(t.browser, "record", () => {});
    await globalThis.recorder.start();
  }, base);
  const input = async (text) =>
    app.evaluate(async (_, text) => {
      const wc = globalThis.awlToolsTest.browser.target(
        "record",
        globalThis.recordTab,
      );
      await wc.executeJavaScript('document.querySelector("input").focus()');
      await wc.debugger.sendCommand("Input.insertText", { text });
    }, text);
  await input("first");
  await input(" query");
  await app.evaluate(async () => {
    await globalThis.recorder.stop();
  });
  let state = await app.evaluate(() => globalThis.recorder.state);
  assert.equal(state.mode, "review");
  assert.equal(state.steps.filter((s) => s.operation === "fill").length, 1);
  assert.equal(
    state.steps.find((s) => s.operation === "fill").value,
    "first query",
  );
  assert.equal(
    state.steps.find((s) => s.operation === "fill").target.kind,
    "placeholder",
  );
  await app.evaluate(async (_, base) => {
    const t = globalThis.awlToolsTest;
    await t.browser.start(
      "record",
      base,
      globalThis.recordTab,
      AbortSignal.timeout(10000),
    );
    await globalThis.recorder.start();
    globalThis.recorder.pause();
  }, base);
  await input("private-value");
  state = await app.evaluate(() => globalThis.recorder.state);
  assert(!JSON.stringify(state).includes("private-value"));
  assert(state.steps.some((s) => s.operation === "gap"));
  await app.evaluate(async (_, base) => {
    const t = globalThis.awlToolsTest;
    await t.browser.start(
      "record",
      base + "/private",
      globalThis.recordTab,
      AbortSignal.timeout(10000),
    );
    try {
      const wc = t.browser.target("record", globalThis.recordTab);
      if (wc.isLoading())
        await new Promise((resolve) => wc.once("did-stop-loading", resolve));
      await globalThis.recorder.start();
      throw new Error("Expected private gate");
    } catch (error) {
      if (error.message === "Expected private gate") throw error;
    }
  }, base);
  assert(
    !(
      await app.evaluate(() => JSON.stringify(globalThis.recorder.state))
    ).includes("never-retain-this"),
  );
  console.log(
    "Recording: coalesced input, final flush, target evidence, private gaps and sensitive-page gate passed.",
  );
} finally {
  await app.close();
  await new Promise((r) => server.close(r));
}
