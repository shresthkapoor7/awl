import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";
const directory = await mkdtemp(join(tmpdir(), "awl-execution-"));
let changed = false;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  if (["/text-form", "/clear-field", "/replace-field"].includes(req.url)) {
    const clear = req.url === "/clear-field";
    const replace = req.url === "/replace-field";
    res.end(`<textarea name="q" role="combobox" aria-label="Search"
      ${clear ? `oninput="setTimeout(()=>{this.value='';document.querySelector('#ready').textContent='Ready'},100)"` : ""}
      ${replace ? `onfocus="if(!window.replaced){window.replaced=true;const next=this.cloneNode(true);this.replaceWith(next);next.focus()}"` : ""}
      onkeydown="if(event.key==='Enter'){event.preventDefault();window.submits=(window.submits||0)+1;document.querySelector('#result').textContent='Submitted: '+this.value}">old query</textarea>
      <p id="ready">${clear ? "Waiting" : "Ready"}</p><p id="result">Waiting</p>`);
    return;
  }
  res.end(
    `<input placeholder="Search papers"><button onclick="window.clicks=(window.clicks||0)+1;setTimeout(()=>document.querySelector('#result').textContent='Results: '+document.querySelector('input').value, 100)">${changed ? "Find" : "Search"}</button>${changed ? "<button>Search</button><button>Search</button>" : ""}<p id="result">Waiting</p>`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, AWL_TEST_ARTIFACTS: directory };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: [resolve("scripts/tools-fixture.cjs")],
  env,
});
const target = (kind, value, role = null) => ({
  kind,
  value,
  role,
  frame: null,
  shadow: [],
  within: null,
});
const step = (operation, options = {}) => ({
  operation,
  target: null,
  selector: null,
  input: null,
  value: null,
  output: null,
  ...options,
});
try {
  await app.firstWindow();
  for (const route of ["text-form", "clear-field", "replace-field"]) {
    const field = target("css", 'textarea[name="q"]');
    const fieldDraft = {
      id: "text_field",
      name: "Submit a text field",
      description: "Verify text before submitting it",
      origin: base,
      expected_version: 0,
      inputs: [{ name: "query", type: "string", description: "Search text" }],
      outputs: [
        { name: "result", type: "string", description: "Submitted text" },
      ],
      steps: [
        step("navigate", { value: `${base}/${route}` }),
        step("fill", { target: field, input: "query" }),
        step("assert_text", {
          target: target("css", "#ready"),
          value: "Ready",
        }),
        step("press", { target: field, value: "Enter" }),
        step("extract_text", {
          target: target("css", "#result"),
          output: "result",
        }),
        step("assert_text", {
          target: target("css", "#result"),
          value: "Submitted: NFL Sunday Ticket",
        }),
      ],
      on_unknown_state: "pause_for_human",
    };
    const result = await app.evaluate(
      async (_, { draft, route, directory }) => {
        const t = globalThis.awlToolsTest;
        const agentId = `field-${route}`;
        const run = new t.Executor.Execution(
          { draft, hash: "fixture", path: joinPath(directory, route) },
          { id: draft.id, sourceChatId: agentId, version: 1 },
          { query: "NFL Sunday Ticket" },
          false,
          {
            agentId,
            browser: t.browser,
            artifactDirectory: directory,
            rename: () => {},
          },
          () => {},
        );
        await run.run(AbortSignal.timeout(10000));
        const tabs = t.browser.tabs(agentId, "list", null);
        const submits = await t.browser
          .target(agentId, tabs.activeTabId)
          .executeJavaScript("window.submits || 0");
        return { state: run.state, submits };
        function joinPath(root, name) {
          return `${root}/${name}`;
        }
      },
      { draft: fieldDraft, route, directory },
    );
    if (route === "clear-field") {
      assert.equal(result.state.status, "paused", JSON.stringify(result));
      assert.match(result.state.error, /FIELD_VALUE_CHANGED/);
      assert.equal(
        result.submits,
        0,
        "Never submit a field whose text was lost",
      );
    } else {
      assert.equal(result.state.status, "completed", JSON.stringify(result));
      assert.equal(result.state.outputs.result, "Submitted: NFL Sunday Ticket");
      assert.equal(
        result.submits,
        1,
        "Replacement recovery must not duplicate input",
      );
    }
  }
  const draft = {
    id: "search_papers",
    name: "Search papers",
    description: "Search and verify results",
    origin: base,
    expected_version: 0,
    inputs: [{ name: "query", type: "string", description: "Paper query" }],
    outputs: [
      { name: "results", type: "string", description: "Visible results" },
    ],
    steps: [
      step("navigate", { value: base + "/" }),
      step("fill", {
        target: target("placeholder", "Search papers"),
        input: "query",
      }),
      step("click", { target: target("role", "Search", "button") }),
      step("extract_text", {
        target: target("css", "#result"),
        output: "results",
      }),
      step("assert_text", {
        target: target("css", "#result"),
        value: "Results:",
      }),
    ],
    on_unknown_state: "pause_for_human",
  };
  const saved = await app.evaluate(
    async (_, draft) =>
      globalThis.awlToolsTest.call(
        "capability-write",
        "capabilityWrite",
        draft,
        "source",
      ),
    draft,
  );
  assert(saved.ok, JSON.stringify(saved));
  await app.evaluate((_, directory) => {
    globalThis.modelCalls = 0;
    const t = globalThis.awlToolsTest;
    globalThis.runtime = new t.AgentRuntime({
      client: {
        responses: {
          create: async (body) => {
            globalThis.modelCalls++;
            if (globalThis.followup) {
              globalThis.followupInput = body.input;
              return {
                status: "completed",
                output_text: "We can discuss that result.",
                output: [],
              };
            }
            if (!globalThis.repairDraft)
              throw new Error("Execution must not call the model");
            const n = globalThis.modelCalls;
            return {
              status: "completed",
              output_text: "",
              output:
                n < 3
                  ? [
                      {
                        type: "function_call",
                        id: `repair${n}`,
                        call_id: `repair${n}`,
                        name: n === 1 ? "capability_read" : "capability_write",
                        arguments: JSON.stringify(
                          n === 1
                            ? { id: "search_papers", version: 1 }
                            : globalThis.repairDraft,
                        ),
                        status: "completed",
                      },
                    ]
                  : [],
            };
          },
        },
      },
      browser: t.browser,
      directory,
      publish: () => {},
    });
  }, directory);
  const ref = { sourceChatId: "source", id: draft.id, version: 1 };
  async function launch(query, validation = true) {
    const result = await app.evaluate(
      (_, { ref, query, validation }) =>
        globalThis.runtime.launch(ref, { query }, validation),
      { ref, query, validation },
    );
    assert(result.chat, result.error);
    let chat;
    for (let n = 0; n < 160; n++) {
      chat = await app.evaluate(
        (_, id) => globalThis.runtime.list().find((c) => c.id === id),
        result.chat.id,
      );
      if (chat.status !== "running") {
        if (chat.status !== "completed")
          console.log(
            "Paused fixture",
            await app.evaluate(async (_, id) => {
              const t = globalThis.awlToolsTest;
              const state = t.browser.tabs(id, "list", null);
              return t.browser
                .target(id, state.activeTabId)
                .executeJavaScript(
                  "JSON.stringify({clicks:window.clicks, visibility:document.visibilityState, value:document.querySelector('input')?.value, result:document.querySelector('#result')?.textContent})",
                );
            }, chat.id),
          );
        return chat;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Run did not settle: " + JSON.stringify(chat));
  }
  const blocked = await app.evaluate(
    (_, ref) => globalThis.runtime.launch(ref, { query: "first" }, false),
    ref,
  );
  assert(blocked.error);
  const first = await launch("attention");
  assert.equal(first.status, "completed", JSON.stringify(first));
  assert.equal(first.execution.outputs.results, "Results: attention");
  const second = await launch("transformers");
  assert.equal(second.status, "completed", JSON.stringify(second));
  const replay = await launch("another query", false);
  assert.equal(replay.status, "completed");
  assert.equal(replay.execution.outputs.results, "Results: another query");
  const afterControl = await app.evaluate((_, id) => {
    globalThis.runtime.takeover(id);
    return globalThis.runtime.list().find((c) => c.id === id);
  }, replay.id);
  assert.equal(afterControl.status, "completed");
  assert.equal(afterControl.pending, null);
  changed = true;
  const broken = await launch("changed page", false);
  assert.equal(broken.status, "waiting");
  assert.match(broken.execution.error, /AMBIGUOUS_TARGET/);
  assert.equal(broken.execution.step, 2);
  assert.equal(await app.evaluate(() => globalThis.modelCalls), 0);
  // Explicit, versioned correction; old artifact stays pinned and unchanged.
  const repaired = structuredClone(draft);
  repaired.expected_version = 1;
  repaired.steps[2].target.value = "Find";
  await app.evaluate((_, repaired) => {
    globalThis.repairDraft = repaired;
  }, repaired);
  const repair = await app.evaluate(
    (_, id) => globalThis.runtime.repair(id),
    broken.id,
  );
  assert(!repair.error, repair.error);
  for (let n = 0; n < 100; n++) {
    const current = await app.evaluate(
      (_, id) => globalThis.runtime.list().find((c) => c.id === id),
      broken.id,
    );
    if (current.status !== "running") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await app.evaluate(() => globalThis.modelCalls), 3);
  ref.sourceChatId = broken.id;
  ref.version = 2;
  assert.equal((await launch("repair first")).status, "completed");
  assert.equal((await launch("repair second")).status, "completed");
  assert.equal((await launch("repaired replay", false)).status, "completed");
  assert.equal(await app.evaluate(() => globalThis.modelCalls), 3);
  const followup = await app.evaluate((_, id) => {
    globalThis.followup = true;
    return globalThis.runtime.send(id, "Explain the result of that run");
  }, replay.id);
  assert.deepEqual(followup, {});
  for (let n = 0; n < 100; n++) {
    const chat = await app.evaluate(
      (_, id) => globalThis.runtime.list().find((c) => c.id === id),
      replay.id,
    );
    if (chat.status !== "running") {
      assert.equal(chat.mode, "discovery");
      assert.equal(chat.execution.status, "completed");
      assert.equal(chat.messages.at(-1).text, "We can discuss that result.");
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(await app.evaluate(() => globalThis.modelCalls), 4);
  assert.match(
    await app.evaluate(() => JSON.stringify(globalThis.followupInput)),
    /Results: another query/,
  );
  console.log(
    "Execution: two-input validation, zero-model runs, observed outputs, ambiguous-target pause and versioned repair passed.",
  );
} finally {
  await app.close();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
