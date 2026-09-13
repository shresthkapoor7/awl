import assert from "node:assert/strict";
import { chatName } from "../dist-electron/electron/tools/chat-name.cjs";
import {
  dispatch,
  toolDefinition,
} from "../dist-electron/electron/tools/core.cjs";
const context = {
  agentId: "test",
  signal: new AbortController().signal,
  rename: (name) => {
    context.name = name;
  },
};
assert.equal(
  (await dispatch(chatName, '{"name":"  Read the docs  "}', context)).ok,
  true,
);
assert.equal(context.name, "Read the docs");
assert.equal(
  (await dispatch(chatName, '{"name":"x","agentId":"someone-else"}', context))
    .ok,
  false,
);
assert.equal((await dispatch(chatName, '{"name":"   "}', context)).ok, false);
assert.equal(
  (await dispatch(chatName, "not json", context)).error.code,
  "INVALID_JSON",
);
assert.equal(toolDefinition(chatName).parameters.additionalProperties, false);
console.log("Passed: chat naming, input validation, chat scope, tool schema.");
const controller = new AbortController();
const pending = dispatch(
  { ...chatName, execute: async () => new Promise(() => {}) },
  '{"name":"wait"}',
  { ...context, signal: controller.signal },
);
controller.abort(new Error("test stop"));
await assert.rejects(pending, /test stop/);
const { evidenceRead } =
  await import("../dist-electron/electron/tools/evidence-read.cjs");
assert.deepEqual(
  (
    await dispatch(evidenceRead, '{"evidence_id":7}', {
      ...context,
      evidence: (id) => (id === 7 ? { observed: "result" } : null),
    })
  ).data,
  { observed: "result" },
);
assert.equal(
  (await dispatch(evidenceRead, '{"evidence_id":7}', context)).error.code,
  "EVIDENCE_EXPIRED",
);
assert.equal(
  (await dispatch(evidenceRead, '{"evidence_id":7,"chat":"other"}', context))
    .ok,
  false,
);
console.log(
  "Passed: exact evidence retrieval, expiration and current-chat scope.",
);
