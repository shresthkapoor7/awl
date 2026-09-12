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
