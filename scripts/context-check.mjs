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
  // Restored capability chats remain conversational, while an interrupted
  // browser run stays stopped and is never silently restarted by a message.
  for (const status of ["completed", "paused"]) {
    await store.save({
      chat: {
        ...chat,
        id: status,
        status: status === "completed" ? "completed" : "waiting",
        pending: null,
        mode: "execution",
        execution: {
          id: "search",
          sourceChatId: "source",
          version: 1,
          status,
          step: 4,
          total: 5,
          inputs: {},
          outputs: {},
          validation: true,
          uncertain: false,
          error: null,
        },
      },
      history: [],
    });
  }
  const conversations = new AgentRuntime({
    client: {
      responses: {
        create: async () => ({
          status: "completed",
          output: [],
          output_text: "Follow-up received.",
        }),
      },
    },
    browser: {},
    directory: "/unused",
    storageDirectory: directory,
    publish: () => {},
  });
  await conversations.ready;
  assert.equal(
    conversations.list().find((c) => c.id === "completed").status,
    "completed",
  );
  assert.equal(
    conversations.list().find((c) => c.id === "paused").status,
    "stopped",
  );
  for (const id of ["completed", "paused"]) {
    assert.deepEqual(conversations.send(id, "Discuss the previous result"), {});
    for (
      let n = 0;
      n < 100 &&
      conversations.list().find((c) => c.id === id).status === "running";
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    const after = conversations.list().find((c) => c.id === id);
    assert.equal(after.mode, "discovery");
    assert.equal(after.messages.at(-1).text, "Follow-up received.");
    assert.equal(after.execution.status, id);
  }
  await conversations.store.flush();
  conversations.close();
  const reopened = new AgentRuntime({
    client: null,
    browser: {},
    directory: "/unused",
    storageDirectory: directory,
    publish: () => {},
  });
  await reopened.ready;
  assert.equal(reopened.list().find((c) => c.id === "paused").status, "idle");
  assert.equal(
    reopened.list().find((c) => c.id === "paused").mode,
    "discovery",
  );
  reopened.close();
  console.log(
    "Context: exact-count compaction, opaque item preservation, interrupted call pairing, atomic persistence and private restart passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
