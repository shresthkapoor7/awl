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
assert.equal(calls[0].tools.length, 9);
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
