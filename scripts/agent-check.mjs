import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import {
  AgentRuntime,
  TERRA_MODEL,
} from "../dist-electron/electron/agent-runtime.cjs";
const calls = [];
const functionCall = (name, args, id) => ({
  type: "function_call",
  id,
  call_id: id,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});
let attempt = 0;
const runtime = new AgentRuntime({
  directory: "/unused",
  browser: {},
  publish: () => {},
  client: {
    responses: {
      async create(body) {
        calls.push(structuredClone(body));
        if (attempt++ === 0)
          return {
            status: "completed",
            output_text: "",
            output: [
              functionCall(
                "chat_set_name",
                { name: "Read the guide" },
                "call1",
              ),
            ],
          };
        if (attempt === 2)
          return {
            status: "completed",
            output_text: "",
            output: [
              functionCall(
                "chat_set_name",
                { name: "x", unexpected: true },
                "call2",
              ),
            ],
          };
        if (attempt === 3)
          return {
            status: "completed",
            output_text: "",
            output: [functionCall("unknown", {}, "call3")],
          };
        return {
          status: "completed",
          output_text: "Ready.",
          output: [
            {
              type: "message",
              id: "msg1",
              role: "assistant",
              status: "completed",
              content: [
                { type: "output_text", text: "Ready.", annotations: [] },
              ],
            },
          ],
        };
      },
    },
  },
});
async function finished(agent) {
  for (let i = 0; i < 100; i++) {
    if (agent.list()[0]?.status !== "running") return;
    await setTimeout(10);
  }
  throw new Error("Runtime did not settle");
}
assert.deepEqual(runtime.send("one", "Name this chat"), {});
assert.ok(runtime.send("one", "overlap").error);
await finished(runtime);
assert.equal(runtime.list()[0].name, "Read the guide");
assert.equal(runtime.list()[0].messages.at(-1).text, "Ready.");
assert.equal(calls[0].model, TERRA_MODEL);
assert.equal(calls[0].parallel_tool_calls, false);
assert.equal(calls[0].store, false);
assert.equal(calls[0].tools.length, 12);
assert.ok(
  calls[0].tools.every(
    (tool) => tool.strict && tool.parameters.additionalProperties === false,
  ),
);
assert.ok(
  calls[2].input.some(
    (item) =>
      item.type === "function_call_output" &&
      JSON.stringify(item.output).includes("INVALID_ARGUMENTS"),
  ),
);
assert.ok(
  calls[3].input.some(
    (item) =>
      item.type === "function_call_output" &&
      JSON.stringify(item.output).includes("UNKNOWN_TOOL"),
  ),
);
const blocked = new AgentRuntime({
  directory: "/unused",
  browser: {},
  publish: () => {},
  client: null,
});
assert.equal(blocked.create("draft-one").status, "idle");
assert.equal(blocked.create("draft-one").id, "draft-one");
assert.equal(blocked.list().length, 1);
assert.ok(blocked.create("../invalid").error);
assert.ok(blocked.send("one", "go").error.includes("OPENAI_API_KEY"));
const stopped = new AgentRuntime({
  directory: "/unused",
  browser: {},
  publish: () => {},
  client: {
    responses: {
      create: (_, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    },
  },
});
stopped.send("two", "Wait");
stopped.stop("two");
await finished(stopped);
assert.equal(stopped.list()[0].status, "stopped");
// Even a late response after Stop must never dispatch its proposed action.
let resolveLate;
let lateRequests = 0;
const late = new AgentRuntime({
  directory: "/unused",
  browser: {},
  publish: () => {},
  client: {
    responses: {
      create: () => {
        lateRequests++;
        return new Promise((resolve) => {
          resolveLate = resolve;
        });
      },
    },
  },
});
late.send("late", "Name the chat");
while (!resolveLate) await setTimeout(0);
late.stop("late");
resolveLate({
  status: "completed",
  output_text: "",
  output: [
    functionCall("chat_set_name", { name: "Should never run" }, "late-call"),
  ],
});
await finished(late);
assert.equal(lateRequests, 1);
assert.equal(late.list()[0].name, "New agent");
assert.equal(late.list()[0].status, "stopped");
assert.equal(late.list()[0].tools.length, 0);
console.log(
  "Passed: Terra selection, tool result loop, strict validation recovery, unknown tools, serialization, cancellation, missing key.",
);

let questionCalls = 0;
const questioning = new AgentRuntime({
  directory: "/unused",
  publish: () => {},
  browser: { tabs: () => ({ tabs: [], activeTabId: "" }) },
  client: {
    responses: {
      create: async () => {
        questionCalls++;
        return questionCalls === 1
          ? {
              status: "completed",
              output_text: "",
              output: [
                functionCall(
                  "ask_user",
                  {
                    reason: "clarification",
                    question: "Which workspace?",
                    choices: ["Personal", "Team"],
                    expected_text: null,
                  },
                  "question-1",
                ),
              ],
            }
          : {
              status: "completed",
              output_text: "Answer received.",
              output: [],
            };
      },
    },
  },
});
questioning.send("ask", "Find the workspace");
await finished(questioning);
const waiting = questioning.list()[0];
assert.equal(waiting.status, "waiting");
assert.equal(waiting.control.owner, "human");
assert.equal(waiting.control.capture, "private");
assert.equal(questionCalls, 1);
assert.ok(questioning.send("ask", "bypass resume").error);
assert.ok((await questioning.resume("ask", "stale", "Team")).error);
assert.deepEqual(
  await questioning.resume("ask", waiting.pending.id, "Team"),
  {},
);
assert.ok((await questioning.resume("ask", waiting.pending.id, "Team")).error);
await finished(questioning);
assert.equal(questionCalls, 2);
assert.equal(
  questioning.list()[0].status,
  "idle",
  "ending an API response is not task completion",
);
assert.equal(questioning.list()[0].pending, null);
console.log(
  "Passed: structured questions, private ownership, explicit resume, stale request rejection, truthful completion.",
);

// Session settings must affect requests and browser policy, survive restart,
// and remain isolated from other chats. These checks run in CI only.
const { mkdtemp, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const settingsDirectory = await mkdtemp(join(tmpdir(), "awl-settings-"));
try {
  const requests = [];
  const access = new Map();
  const options = {
    directory: "/unused",
    storageDirectory: settingsDirectory,
    browser: { setAccess: (id, value) => access.set(id, value) },
    publish: () => {},
    client: {
      responses: {
        async create(body) {
          requests.push(structuredClone(body));
          return {
            status: "completed",
            output_text: "Observed the page.",
            output: [
              {
                type: "reasoning",
                id: "opaque-reasoning",
                summary: [],
                encrypted_content: "fixture-only",
              },
            ],
          };
        },
      },
    },
  };
  const settingsRuntime = new AgentRuntime(options);
  await settingsRuntime.ready;
  assert.deepEqual(settingsRuntime.send("settings", "Inspect this page"), {});
  await finished(settingsRuntime);
  assert.equal(requests[0].model, TERRA_MODEL);
  assert.ok(
    settingsRuntime.configure("settings", { model: "", access: "configured" })
      .error,
  );
  assert.ok(
    settingsRuntime.configure("settings", {
      model: "fixture-model",
      access: "full",
    }).error,
  );
  assert.deepEqual(
    settingsRuntime.configure("settings", {
      model: "fixture-model",
      access: "read_only",
    }),
    {},
  );
  assert.equal(access.get("settings"), "read_only");
  assert.deepEqual(settingsRuntime.send("settings", "What changed?"), {});
  assert.ok(
    settingsRuntime.configure("settings", {
      model: TERRA_MODEL,
      access: "configured",
    }).error,
  );
  await finished(settingsRuntime);
  assert.equal(requests[1].model, "fixture-model");
  assert.match(requests[1].instructions, /read-only browser mode/);
  assert.ok(
    requests[1].input.some((item) => item.content === "Observed the page."),
  );
  assert.ok(
    !requests[1].input.some(
      (item) => item.type === "reasoning" || item.type === "compaction",
    ),
  );
  assert.equal(settingsRuntime.list()[0].messages[1].model, TERRA_MODEL);
  assert.equal(
    settingsRuntime.list()[0].messages.at(-1).model,
    "fixture-model",
  );
  assert.equal(settingsRuntime.create("other").settings.access, "configured");
  assert.equal(
    settingsRuntime.list().find((chat) => chat.id === "other").settings.model,
    TERRA_MODEL,
  );
  await settingsRuntime.flush();
  settingsRuntime.close();
  access.clear();
  const restoredSettings = new AgentRuntime(options);
  await restoredSettings.ready;
  assert.deepEqual(
    restoredSettings.list().find((chat) => chat.id === "settings").settings,
    { model: "fixture-model", access: "read_only" },
  );
  assert.equal(access.get("settings"), "read_only");
  assert.equal(
    restoredSettings
      .list()
      .find((chat) => chat.id === "settings")
      .messages.at(-1).model,
    "fixture-model",
  );
  restoredSettings.close();
} finally {
  await rm(settingsDirectory, { recursive: true, force: true });
}
console.log(
  "Passed: per-chat models, access controls, idle-only settings, portable context, persisted settings.",
);
