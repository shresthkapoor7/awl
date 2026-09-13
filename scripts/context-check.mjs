import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetContext,
  closeOpenCalls,
} from "../dist-electron/electron/context.cjs";
import { WorkspaceStore } from "../dist-electron/electron/workspace-store.cjs";
import { AgentRuntime } from "../dist-electron/electron/agent-runtime.cjs";
const history = [
  {
    type: "function_call",
    call_id: "interrupted",
    name: "browser_action",
    arguments: "{}",
  },
];
closeOpenCalls(history);
closeOpenCalls(history);
assert.equal(history.length, 2);
const compacted = [
  { type: "compaction", id: "compact", encrypted_content: "opaque" },
];
let count = 0;
let compactCalls = 0;
const client = {
  inputTokens: {
    count: async () => ({ input_tokens: ++count === 1 ? 60000 : 1000 }),
  },
  compact: async ({ input }) => {
    compactCalls++;
    assert.equal(input[1].call_id, "interrupted");
    return { output: compacted };
  },
};
const result = await budgetContext(
  client,
  history,
  "gpt-5.6-terra",
  "Goal and safety rules",
  [],
  AbortSignal.timeout(1000),
);
assert.equal(result.compacted, true);
assert.deepEqual(result.input, compacted);
assert.equal(compactCalls, 1);
await assert.rejects(
  () =>
    budgetContext({}, history, "test", "", [], AbortSignal.timeout(1000), 1),
  /CONTEXT_LIMIT/,
);
const directory = await mkdtemp(join(tmpdir(), "awl-context-"));
try {
  const store = new WorkspaceStore(directory);
  const chat = {
    id: "saved",
    name: "Saved task",
    status: "running",
    control: { owner: "agent", capture: "observe", generation: 1 },
    messages: [{ id: "one", role: "user", text: "Search a paper" }],
    tools: [],
    pending: {
      id: "request",
      reason: "clarification",
      question: "Which paper?",
      choices: [],
      expected_text: null,
    },
    error: null,
  };
  await store.save({ chat, history });
  const runtime = new AgentRuntime({
    client: null,
    browser: {},
    directory: "/unused",
    storageDirectory: directory,
    publish: () => {},
  });
  await runtime.ready;
  const restored = runtime.list()[0];
  assert.equal(restored.control.owner, "human");
  assert.equal(restored.control.capture, "private");
  assert.equal(restored.status, "stopped");
  assert.equal(restored.pending.id, "request");
  assert.match(restored.error, /not restored/);
  assert.deepEqual(await readdir(directory), ["saved.json"]);
  assert.equal(
    JSON.parse(await readFile(join(directory, "saved.json"))).history.length,
    2,
  );
  await store.remove("saved");
  assert.equal((await store.load()).length, 0);
  runtime.close();
  console.log(
    "Context: exact-count compaction, opaque item preservation, interrupted call pairing, atomic persistence and private restart passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
