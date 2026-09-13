import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
const directory = await mkdtemp(join(tmpdir(), "awl-record-build-"));
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/choices") {
    res.end(
      '<label>Primary account<input type="radio" name="account" value="customer-private-19321"></label><label>Secondary account<input type="radio" name="account" value="customer-private-83712"></label>',
    );
    return;
  }

  res.end(
    req.url === "/private"
      ? '<input name="otp" value="never-retain-this">'
      : req.url.startsWith("/result")
        ? '<p id="result">Results</p><input placeholder="Refine papers">'
        : '<form action="/result"><input name="q" placeholder="Search papers"><button>Search</button></form>',
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
    globalThis.recordPublications = [];
    globalThis.recorder = new t.Recorder(t.browser, "record", (state) =>
      globalThis.recordPublications.push(JSON.stringify(state)),
    );
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
  assert.equal(state.steps.find((s) => s.operation === "fill").value, null);
  assert(
    !(
      await app.evaluate(() => globalThis.recordPublications.join("\n"))
    ).includes("first query"),
  );
  assert.equal(
    state.steps.find((s) => s.operation === "fill").target.kind,
    "css",
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
    const wc = t.browser.target("record", globalThis.recordTab);
    if (wc.isLoading())
      await new Promise((resolve) => wc.once("did-stop-loading", resolve));
    await globalThis.recorder.start();
  }, base);
  assert.equal(
    await app.evaluate(() => globalThis.recorder.state.mode),
    "recording",
  );
  await input("private-otp-entry");
  assert(
    !(
      await app.evaluate(() => JSON.stringify(globalThis.recorder.state))
    ).includes("private-otp-entry"),
  );
  assert(
    !(
      await app.evaluate(() => JSON.stringify(globalThis.recorder.state))
    ).includes("never-retain-this"),
  );
  await app.evaluate(async (_, base) => {
    const t = globalThis.awlToolsTest;
    await t.browser.start(
      "record",
      base,
      globalThis.recordTab,
      AbortSignal.timeout(10000),
    );
    const wc = t.browser.target("record", globalThis.recordTab);
    if (wc.isLoading())
      await new Promise((resolve) => wc.once("did-stop-loading", resolve));
    await globalThis.recorder.reset();
    await globalThis.recorder.start();
    await globalThis.recorder.stop();
  }, base);
  state = await app.evaluate(() => globalThis.recorder.state);
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].operation, "navigate");
  await app.evaluate(async (_, base) => {
    const t = globalThis.awlToolsTest;
    await t.browser.start(
      "record",
      base,
      globalThis.recordTab,
      AbortSignal.timeout(10000),
    );
    const wc = t.browser.target("record", globalThis.recordTab);
    if (wc.isLoading())
      await new Promise((r) => wc.once("did-stop-loading", r));
    await globalThis.recorder.reset();
    await globalThis.recorder.start();
    // Large ordinary feeds and disappearing ad frames must not stop capture.
    await wc.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<span></span>'.repeat(21000));
      window.churn=setInterval(()=>{const f=document.createElement('iframe');f.srcdoc='<span>ad</span>';document.body.append(f);setTimeout(()=>f.remove(),15)},30)`);
  }, base);
  await input("navigation query");
  await app.evaluate(async () => {
    const wc = globalThis.awlToolsTest.browser.target(
      "record",
      globalThis.recordTab,
    );
    const loaded = new Promise((r, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Recorded form did not navigate")),
        10000,
      );
      wc.once("did-finish-load", () => {
        clearTimeout(timeout);
        r();
      });
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: "\r",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await loaded;
  });
  // New-document hooks must work without waiting for the polling interval.
  await input("refined query");
  await app.evaluate(async () => {
    await globalThis.recorder.stop();
  });
  state = await app.evaluate(() => globalThis.recorder.state);
  assert.equal(state.mode, "review");
  assert(
    state.steps.some((s) => s.operation === "press" && s.value === "Enter"),
  );
  assert(
    state.steps.some(
      (s) =>
        s.operation === "fill" &&
        s.target?.value === "Refine papers" &&
        s.value === null,
    ),
    JSON.stringify(state),
  );
  assert(!JSON.stringify(state).includes("refined query"));
  assert(
    !state.steps.some((s) => s.operation === "gap"),
    JSON.stringify(state),
  );
  const pressIndex = state.steps.findIndex((s) => s.operation === "press");
  const destinationIndex = state.steps.findIndex(
    (s) => s.operation === "navigate" && s.url.endsWith("/result"),
  );
  assert(
    pressIndex < destinationIndex && destinationIndex < state.steps.length - 1,
  );
  const listenersAfterStop = await app.evaluate(async () => {
    const wc = globalThis.awlToolsTest.browser.target(
      "record",
      globalThis.recordTab,
    );
    const loaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Reload did not finish")),
        10000,
      );
      wc.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    wc.reload();
    await loaded;
    const { frameTree } = await wc.debugger.sendCommand("Page.getFrameTree");
    const { executionContextId } = await wc.debugger.sendCommand(
      "Page.createIsolatedWorld",
      { frameId: frameTree.frame.id, worldName: "awl-tools" },
    );
    const result = await wc.debugger.sendCommand("Runtime.evaluate", {
      contextId: executionContextId,
      expression: "Boolean(globalThis.__awlRecorder)",
      returnByValue: true,
    });
    return result.result.value;
  });
  assert.equal(listenersAfterStop, false);

  // Stop starts the model automatically, supplies parameterized evidence, and
  // saves a draft through the real tool. It must not replay browser actions.
  await app.evaluate(
    async (_, { base, directory }) => {
      const t = globalThis.awlToolsTest;
      globalThis.buildCalls = [];
      globalThis.builder = new t.AgentRuntime({
        browser: t.browser,
        directory,
        publish: () => {},
        client: {
          responses: {
            create: async (body) => {
              globalThis.buildCalls.push(structuredClone(body));
              const n = globalThis.buildCalls.length;
              let output = [];
              if (n === 1)
                output = [
                  {
                    type: "function_call",
                    id: "inspect",
                    call_id: "inspect",
                    name: "browser_dom",
                    arguments: JSON.stringify({
                      tab_id: null,
                      frame_id: null,
                      offset: 0,
                      limit: 50,
                    }),
                  },
                ];
              if (n === 2) {
                const recorded = body.input.find(
                  (i) =>
                    typeof i.content === "string" &&
                    i.content.startsWith("Recorded demonstration data"),
                );
                const evidence = JSON.parse(
                  recorded.content.slice(recorded.content.indexOf(": ") + 2),
                );
                const fill = evidence.find((s) => s.operation === "fill");
                const step = (operation, extra = {}) => ({
                  operation,
                  selector: null,
                  target: null,
                  input: null,
                  output: null,
                  value: null,
                  ...extra,
                });
                const draft = {
                  id: "recorded_search",
                  name: "Recorded search",
                  description: "Search from a demonstration",
                  expected_version: 0,
                  origin: base,
                  inputs: [
                    {
                      name: "query",
                      type: "string",
                      description: "Paper query",
                    },
                  ],
                  outputs: [
                    {
                      name: "results",
                      type: "string",
                      description: "Result heading",
                    },
                  ],
                  steps: [
                    step("navigate", { value: base }),
                    step("fill", { target: fill.target, input: "query" }),
                    step("press", { target: fill.target, value: "Enter" }),
                    step("extract_text", {
                      selector: "#result",
                      output: "results",
                    }),
                    step("assert_text", {
                      selector: "#result",
                      value: "Results",
                    }),
                  ],
                  on_unknown_state: "pause_for_human",
                };
                output = [
                  {
                    type: "function_call",
                    id: "write",
                    call_id: "write",
                    name: "capability_write",
                    arguments: JSON.stringify(draft),
                  },
                ];
              }
              return {
                status: "completed",
                output,
                output_text: n === 3 ? "Capability draft saved." : "",
              };
            },
          },
        },
      });
      globalThis.builder.create("record");
      await t.browser.start(
        "record",
        base,
        globalThis.recordTab,
        AbortSignal.timeout(10000),
      );
      const wc = t.browser.target("record", globalThis.recordTab);
      if (wc.isLoading())
        await new Promise((r) => wc.once("did-stop-loading", r));
      const result = await globalThis.builder.record("record", "start");
      if (result.error) throw new Error(result.error);
    },
    { base, directory },
  );
  await input("automatic topic");
  await app.evaluate(async () => {
    const wc = globalThis.awlToolsTest.browser.target(
      "record",
      globalThis.recordTab,
    );
    const loaded = new Promise((r, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Recorded form did not navigate")),
        10000,
      );
      wc.once("did-finish-load", () => {
        clearTimeout(timeout);
        r();
      });
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: "\r",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await loaded;
  });
  assert.equal(await app.evaluate(() => globalThis.buildCalls.length), 0);
  const stopped = await app.evaluate(() =>
    globalThis.builder.record("record", "stop"),
  );
  assert.deepEqual(stopped, {});
  for (let n = 0; n < 100; n++) {
    if (
      await app.evaluate(
        () => globalThis.builder.list()[0].status !== "running",
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const chat = await app.evaluate(() => globalThis.builder.list()[0]);
  assert.equal(
    chat.messages.at(-1).text,
    "Capability draft saved.",
    JSON.stringify(chat),
  );
  assert.equal(chat.pending, null);
  assert.equal(chat.demonstration.mode, "review");
  assert.equal(await app.evaluate(() => globalThis.buildCalls.length), 3);
  const writeResult = await app.evaluate(() =>
    globalThis.buildCalls[2].input.find(
      (i) => i.type === "function_call_output" && i.call_id === "write",
    ),
  );
  assert.equal(
    JSON.parse(writeResult.output[0].text).ok,
    true,
    JSON.stringify(writeResult.output),
  );
  const evidenceInput = await app.evaluate(() =>
    JSON.stringify(globalThis.buildCalls[0].input),
  );
  assert.match(evidenceInput, /input_1/);
  assert(!evidenceInput.includes("automatic topic"));
  const artifact = JSON.parse(
    await readFile(join(directory, "record/recorded_search/v1.json"), "utf8"),
  );
  assert.equal(artifact.status, "draft");
  assert.equal(artifact.inputs[0].name, "query");
  await app.evaluate(() => globalThis.builder.close());
  console.log(
    "Recording: live event delivery, navigation, large feeds, private capture, final flush and automatic Stop-to-draft passed.",
  );
  const choiceRecording = await app.evaluate(async (_, base) => {
    const t = globalThis.awlToolsTest;
    const opened = await t.browser.start(
      "record-choices",
      `${base}/choices`,
      null,
      AbortSignal.timeout(10000),
    );
    const wc = t.browser.target("record-choices", opened.activeTabId);
    const recorder = new t.Recorder(t.browser, "record-choices", () => {});
    await recorder.start();
    const point = await wc.executeJavaScript(
      `(() => { const r = document.querySelector('input').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await recorder.stop();
    return {
      recording: recorder.state,
      checked: await wc.executeJavaScript(
        "document.querySelector('input').checked",
      ),
    };
  }, base);
  assert.equal(choiceRecording.checked, true);
  const recordedChoice = choiceRecording.recording.steps.find(
    (step) => step.operation === "click",
  );
  assert.ok(recordedChoice, "native radio selection is recorded");
  assert.equal(recordedChoice.target.kind, "role");
  assert.equal(recordedChoice.target.role, "radio");
  assert.equal(recordedChoice.target.value, "Primary account");
  assert.ok(
    !JSON.stringify(choiceRecording.recording).includes("customer-private-"),
    "recorded targets never include raw radio values",
  );
} finally {
  await app.close();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
