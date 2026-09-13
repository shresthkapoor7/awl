import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  utimes,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetContext,
  closeOpenCalls,
} from "../dist-electron/electron/context.cjs";
import { WorkspaceStore } from "../dist-electron/electron/workspace-store.cjs";
import { AgentRuntime } from "../dist-electron/electron/agent-runtime.cjs";
import { rememberPrivate, redactText } from "../dist-electron/electron/privacy.cjs";
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
  const legacyDirectory = join(directory, "legacy");
  const rawRecording = {
    mode: "review",
    notice: null,
    steps: [
      {
        id: "entry",
        at: new Date().toISOString(),
        operation: "fill",
        target: null,
        value: "unrecognized-secret-entry",
        url: null,
        tab: 0,
        outcome: "Observed action",
      },
    ],
  };
  const privatePath = join(directory, "private_record.json");
  await writeFile(
    privatePath,
    JSON.stringify({
      version: 1,
      chat: { ...chat, id: "private_record", demonstration: rawRecording },
      history: [],
    }),
  );
  const redacted = await store.load();
  assert.equal(
    redacted.find((item) => item.chat.id === "private_record").chat
      .demonstration.steps[0].value,
    null,
  );
  assert(
    !(await readFile(privatePath, "utf8")).includes(
      "unrecognized-secret-entry",
    ),
  );
  await store.save({
    chat: { ...chat, id: "private_record", demonstration: rawRecording },
    history: [],
  });
  assert(
    !(await readFile(privatePath, "utf8")).includes(
      "unrecognized-secret-entry",
    ),
  );
  await store.remove("private_record");
  const corruptDirectory = join(directory, "corrupt");
  await mkdir(corruptDirectory);
  const corruptions = [
    { demonstration: "broken" },
    { execution: 4 },
    { control: [] },
    { pending: { choices: [null] } },
    { messages: [null] },
    { tools: [{}] },
    { journal: [null] },
  ];
  for (let index = 0; index < 36; index++) {
    const id = `bad_${index}`;
    await writeFile(
      join(corruptDirectory, `${id}.json`),
      JSON.stringify({
        version: 1,
        chat: { ...chat, id, ...corruptions[index % corruptions.length] },
        history: [],
      }),
    );
  }
  for (const [id, history] of [
    ["bad_history", [null]],
    [
      "bad_output",
      [{ type: "function_call_output", call_id: "call", output: [null] }],
    ],
  ]) {
    await writeFile(
      join(corruptDirectory, `${id}.json`),
      JSON.stringify({ version: 1, chat: { ...chat, id }, history }),
    );
  }
  const opaque = {
    type: "compaction",
    id: "opaque-id",
    encrypted_content: "opaque",
    future_metadata: { keep: true },
  };
  await new WorkspaceStore(corruptDirectory).save({
    chat: { ...chat, id: "valid" },
    history: [opaque],
  });
  const corruptRuntime = new AgentRuntime({
    client: null,
    browser: {},
    directory: "/unused",
    storageDirectory: corruptDirectory,
    publish: () => {},
  });
  await corruptRuntime.ready;
  assert.deepEqual(
    corruptRuntime.list().map((chat) => chat.id),
    ["valid"],
  );
  assert.deepEqual(
    (await new WorkspaceStore(corruptDirectory).load())[0].history,
    chat.messages.map((message) => ({
      role: message.role,
      content: message.text,
    })),
  );
  corruptRuntime.close();
  await rm(corruptDirectory, { recursive: true });
  const legacyStore = new WorkspaceStore(legacyDirectory);
  for (const [id, time] of [
    ["z_older", 1600000000],
    ["b_newer", 1700000000],
    ["a_same_time", 1700000000],
  ]) {
    await legacyStore.save({
      chat: { ...chat, id, createdAt: 0 },
      history: [],
    });
    await utimes(join(legacyDirectory, `${id}.json`), time, time);
  }
  const legacy = new AgentRuntime({
    client: null,
    browser: {},
    directory: "/unused",
    storageDirectory: legacyDirectory,
    publish: () => {},
  });
  await legacy.ready;
  assert.deepEqual(
    legacy.list().map((chat) => chat.id),
    ["a_same_time", "b_newer", "z_older"],
  );
  assert.equal(legacy.list()[0].createdAt, 1700000000000);
  const migration = await legacyStore.load();
  assert.equal(
    migration.find((item) => item.chat.id === "b_newer").chat.createdAt,
    1700000000000,
  );
  legacy.close();
  await rm(legacyDirectory, { recursive: true });
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
    chat.messages.length,
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
  reopened.create("newest_a");
  reopened.create("newest_b");
  assert.deepEqual(
    reopened
      .list()
      .slice(0, 2)
      .map((chat) => chat.id),
    ["newest_b", "newest_a"],
  );
  await reopened.flush();
  const ordered = new AgentRuntime({
    client: null,
    browser: {},
    directory: "/unused",
    storageDirectory: directory,
    publish: () => {},
  });
  await ordered.ready;
  assert.deepEqual(
    ordered
      .list()
      .slice(0, 2)
      .map((chat) => chat.id),
    ["newest_b", "newest_a"],
  );
  ordered.close();
  assert.equal(reopened.list().find((c) => c.id === "paused").status, "idle");
  assert.equal(
    reopened.list().find((c) => c.id === "paused").mode,
    "discovery",
  );
  reopened.close();
  const removedBrowsers = [];
  const deleting = new AgentRuntime({
    client: {
      responses: {
        create: async (_, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
            if (signal.aborted) reject(signal.reason);
          }),
      },
    },
    browser: {
      removeSession: async (id) => {
        removedBrowsers.push(id);
      },
    },
    directory: "/unused",
    storageDirectory: directory,
    publish: () => {},
  });
  await deleting.ready;
  deleting.create("delete_retry");
  rememberPrivate(["Deletion private customer"], "delete_retry");
  await deleting.flush();
  const removeRecord = deleting.store.remove.bind(deleting.store);
  deleting.store.remove = async () => {
    throw new Error("Simulated disk failure");
  };
  assert((await deleting.deleteSession("delete_retry")).error);
  assert.equal(
    redactText("Deletion private customer", "delete_retry"),
    "[private]",
  );
  assert(deleting.list().some((chat) => chat.id === "delete_retry"));
  assert.deepEqual(
    removedBrowsers,
    [],
    "Do not destroy a browser when deleting its record fails",
  );
  deleting.store.remove = removeRecord;
  assert.deepEqual(await deleting.deleteSession("delete_retry"), {});
  assert.equal(
    redactText("Deletion private customer", "delete_retry"),
    "Deletion private customer",
  );
  assert.deepEqual(removedBrowsers.splice(0), ["delete_retry"]);
  deleting.create("delete_running");
  assert.deepEqual(
    deleting.send("delete_running", "Wait for cancellation"),
    {},
  );
  assert.deepEqual(await deleting.deleteSession("delete_running"), {});
  assert(!deleting.list().some((chat) => chat.id === "delete_running"));
  assert(
    deleting.create("delete_running").error,
    "Late work cannot recreate a deleted session",
  );
  assert.deepEqual(removedBrowsers, ["delete_running"]);
  deleting.create("cleanup_failure");
  rememberPrivate(["Cleanup private customer"], "cleanup_failure");
  deleting.options.browser.removeSession = async () => {
    throw new Error("Simulated cache cleanup failure");
  };
  assert.deepEqual(await deleting.deleteSession("cleanup_failure"), {});
  assert.equal(
    redactText("Cleanup private customer", "cleanup_failure"),
    "Cleanup private customer",
  );
  assert(!deleting.list().some((chat) => chat.id === "cleanup_failure"));
  await deleting.flush();
  const afterDeletion = await new WorkspaceStore(directory).load();
  assert(!afterDeletion.some((item) => item.chat.id === "cleanup_failure"));
  assert(!afterDeletion.some((item) => item.chat.id === "delete_running"));
  assert(
    afterDeletion.some((item) => item.chat.id === "completed"),
    "Keep other sessions",
  );
  deleting.close();
  console.log(
    "Context: exact-count compaction, opaque item preservation, interrupted call pairing, atomic persistence and private restart passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
