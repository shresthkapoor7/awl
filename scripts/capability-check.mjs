import { readCapabilityCatalog } from "../dist-electron/electron/capability-catalog.cjs";
import { capabilityRead } from "../dist-electron/electron/tools/capability-read.cjs";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilityWrite } from "../dist-electron/electron/tools/capability-write.cjs";
import { dispatch } from "../dist-electron/electron/tools/core.cjs";
const directory = await mkdtemp(join(tmpdir(), "awl-capability-"));
const context = {
  agentId: "one",
  artifactDirectory: directory,
  signal: new AbortController().signal,
};
const step = (
  operation,
  selector,
  value = null,
  input = null,
  output = null,
) => ({ operation, selector, value, input, output });
const draft = {
  id: "lookup",
  name: "Look it up",
  description: "Read a record",
  origin: "https://example.com",
  expected_version: 0,
  inputs: [{ name: "query", type: "string", description: "Search query" }],
  outputs: [{ name: "result", type: "string", description: "Result text" }],
  steps: [
    step("navigate", null, "https://example.com/"),
    step("fill", "#query", null, "query"),
    step("extract_text", "#result", null, null, "result"),
    step("assert_text", "h1", "Found"),
  ],
  on_unknown_state: "pause_for_human",
};
const call = (data) => dispatch(capabilityWrite, JSON.stringify(data), context);
try {
  assert.equal((await call({ ...draft, id: "../../escape" })).ok, false);
  assert.equal(
    (
      await call({
        ...draft,
        steps: [
          ...draft.steps.slice(0, 1),
          step("fill", "#query", "secret"),
          ...draft.steps.slice(2),
        ],
      })
    ).error.code,
    "INVALID_CAPABILITY",
  );
  assert.equal((await call(draft)).data.version, 1);
  assert.equal((await call(draft)).error.code, "VERSION_CONFLICT");
  const results = await Promise.all([
    call({ ...draft, expected_version: 1 }),
    call({ ...draft, expected_version: 1 }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal((await readdir(join(directory, "one", "lookup"))).length, 2);
  const saved = JSON.parse(
    await readFile(join(directory, "one", "lookup", "v1.json"), "utf8"),
  );
  assert.equal(saved.status, "draft");
  assert.equal(saved.source_chat_id, "one");
  const read = (args) =>
    dispatch(capabilityRead, JSON.stringify(args), context);
  assert.deepEqual((await read({ id: null, version: null })).data.ids, [
    "lookup",
  ]);
  assert.equal((await read({ id: "lookup", version: null })).data.version, 2);
  assert.equal((await read({ id: "lookup", version: 1 })).data.version, 1);
  assert.equal(
    (await read({ id: "lookup", version: 9 })).error.code,
    "CAPABILITY_NOT_FOUND",
  );
  const catalog = await readCapabilityCatalog(directory);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].version, 2);
  assert.equal(catalog[0].sourceChatId, "one");
  assert.equal(JSON.parse(catalog[0].contract).status, "draft");
  console.log(
    "Passed: capability schema, parameterization, path constraints, immutable versions, conflicting writes.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
