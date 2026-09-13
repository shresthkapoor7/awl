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

const { observedBrowserState, observationURL } =
  await import("../dist-electron/electron/tools/observation-url.cjs");
const raw = {
  tabs: [
    {
      id: "tab",
      url: "https://example.com/callback?code=private-code#access_token=private-token",
    },
  ],
};
const observed = observedBrowserState(raw);
assert.equal(observed.tabs[0].url, "https://example.com/callback");
assert.equal(
  raw.tabs[0].url.includes("private-code"),
  true,
  "The human browser retains its actual URL",
);
assert.equal(
  observationURL("https://user:password@example.com/page?token=secret"),
  "https://example.com/page",
);
console.log(
  "Passed: URL query, fragment and credential exclusion from model observations.",
);
