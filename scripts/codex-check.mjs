import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  copyFile,
  chmod,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodexProvider } from "../dist-electron/electron/codex-provider.cjs";
import { AgentRuntime } from "../dist-electron/electron/agent-runtime.cjs";
import { WorkspaceStore } from "../dist-electron/electron/workspace-store.cjs";
import { rememberPrivate } from "../dist-electron/electron/privacy.cjs";
const root = await mkdtemp(join(tmpdir(), "awl-codex-"));
const binary = join(root, "codex-fixture");
await copyFile(resolve("scripts/codex-fixture.cjs"), binary);
await chmod(binary, 0o700);
const provider = new CodexProvider({ directory: root, binary });
const transcripts = async (id) =>
  (await readFile(join(root, id, "protocol.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
async function run(sessionId, extra = {}) {
  const messages = [],
    calls = [],
    threads = [],
    tokens = [];
  let compacted = 0;
  await provider.run({
    sessionId,
    model: "fixture-model",
    input: "[]",
    instructions: "awl fixture",
    tools: [
      {
        name: "chat_set_name",
        description: "Name chat",
        parameters: { type: "object" },
      },
    ],
    signal: AbortSignal.timeout(8000),
    onThread: (id) => threads.push(id),
    onAccepted() {},
    onMessage: (id, text) => messages.push({ id, text }),
    onTokens: (n) => tokens.push(n),
    onCompacted: () => compacted++,
    callTool: async (call) => {
      calls.push(call);
      return {
        success: true,
        text: "safe tool result",
        image: "data:image/png;base64,fixture",
        stop: sessionId === "stop",
      };
    },
    ...extra,
  });
  return { messages, calls, threads, tokens, compacted };
}
try {
  const happy = await run("happy");
  assert.deepEqual(happy.threads, ["happy-thread"]);
  assert.equal(happy.calls.length, 1);
  assert.deepEqual(happy.messages, [{ id: "answer", text: "Done." }]);
  assert.deepEqual(happy.tokens, [321]);
  assert.equal(happy.compacted, 1);
  let released = false;
  await run("durable-acceptance", {
    onAccepted: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      released = true;
    },
    callTool: async () => {
      assert(
        released,
        "No browser tool may run before acknowledgement is durable",
      );
      return { success: true, text: "saved" };
    },
  });
  let rejectedTools = 0;
  await assert.rejects(
    run("failed-acceptance", {
      onAccepted: async () => {
        throw new Error("Disk full");
      },
      callTool: async () => {
        rejectedTools++;
        return { success: true, text: "must not run" };
      },
    }),
    /Disk full/,
  );
  assert.equal(rejectedTools, 0);
  const transcript = await transcripts("happy");
  const start = transcript.find((m) => m.method === "thread/start").params;
  assert.equal(start.sandbox, "read-only");
  assert.equal(start.approvalPolicy, "never");
  assert.equal(start.config['mcp_servers."external".enabled'], false);
  assert.equal(start.config['mcp_servers."external.with.dots".enabled'], false);
  assert.equal(start.config["features.shell_tool"], false);
  assert.equal(start.dynamicTools[0].name, "chat_set_name");
  assert.equal(start.dynamicTools[0].type, "function");
  assert.deepEqual(transcript.find((m) => m.id === 100).result.contentItems, [
    { type: "inputText", text: "safe tool result" },
    { type: "inputImage", imageUrl: "data:image/png;base64,fixture" },
  ]);
  await run("resumed", { threadId: "resumed-thread" });
  const resumed = await transcripts("resumed");
  assert.equal(
    resumed.find((m) => m.method === "thread/resume").params.threadId,
    "resumed-thread",
  );
  assert(
    !resumed.some(
      (m) => m.method === "thread/start" || m.method === "thread/list",
    ),
  );
  assert.equal((await run("early")).messages[0].text, "Early message");
  assert.equal((await run("spoof")).calls.length, 0);
  assert.equal((await run("unsupported")).calls.length, 0);
  assert((await transcripts("unsupported")).find((m) => m.id === 98).error);
  assert.equal((await run("duplicate")).calls.length, 1);
  assert.equal((await run("stop")).calls.length, 1);
  const controller = new AbortController();
  await assert.rejects(
    run("cancel", {
      signal: controller.signal,
      onAccepted: () => controller.abort(new Error("User stopped")),
    }),
    /User stopped/,
  );
  assert(!(await transcripts("cancel")).some((m) => m.id === 100));
  await assert.rejects(run("login"), /codex login/);
  assert(
    !(await transcripts("login")).some((m) => m.method === "thread/start"),
  );
  await assert.rejects(run("exit"), /Codex exited/);
  await assert.rejects(run("failure"), /could not finish/);
  await assert.rejects(
    run("missing-thread", { threadId: "missing-thread-thread" }),
    /rejected/,
  );
  assert(
    !(await transcripts("missing-thread")).some(
      (m) => m.method === "thread/start",
    ),
  );

  // Runtime boundary: migrate redacted legacy text, persist only awl's thread
  // mapping, send only new input on follow-up, and resume without importing chats.
  const storageDirectory = join(root, "workspace");
  const store = new WorkspaceStore(storageDirectory);
  await store.save({
    chat: {
      id: "legacy",
      name: "Legacy",
      status: "idle",
      error: null,
      tools: [],
      messages: [{ id: "old", role: "user", text: "Earlier goal" }],
    },
    history: [],
  });
  const requests = [];
  let toolReply;
  const client = {
    close() {},
    async run(turn) {
      requests.push({
        input: JSON.parse(turn.input),
        threadId: turn.threadId,
        model: turn.model,
      });
      turn.onThread(turn.threadId ?? `codex-${turn.sessionId}`);
      await turn.onAccepted();
      toolReply = await turn.callTool(
        {
          id: `call-${requests.length}`,
          name: "chat_set_name",
          arguments: JSON.stringify({ name: "Private customer fixture" }),
        },
        turn.signal,
      );
      turn.onMessage(
        `message-${requests.length}`,
        "Hello Private customer fixture",
      );
    },
  };
  const options = {
    client,
    browser: {},
    directory: join(root, "capabilities"),
    storageDirectory,
    publish() {},
  };
  const runtime = new AgentRuntime(options);
  await runtime.ready;
  rememberPrivate(["Private customer fixture"], "legacy");
  runtime.send("legacy", "Continue");
  // flush isn't a turn barrier; observe idle with a bounded CI-only wait.
  async function settled(r) {
    for (let n = 0; n < 100; n++) {
      if (!r.list().some((c) => c.status === "running")) {
        await r.flush();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Runtime did not settle");
  }
  await settled(runtime);
  assert(requests[0].input.some((m) => m.content === "Earlier goal"));
  assert.equal(requests[0].threadId, undefined);
  assert(!toolReply.text.includes("Private customer fixture"));
  assert.equal(runtime.list()[0].messages.at(-1).text, "Hello [private]");
  assert.equal((await store.load())[0].codexThreadId, "codex-legacy");
  runtime.send("legacy", "New question");
  await settled(runtime);
  assert.deepEqual(requests[1].input, [
    { role: "user", content: "New question" },
  ]);
  assert.equal(requests[1].threadId, "codex-legacy");
  runtime.close();
  const restored = new AgentRuntime(options);
  await restored.ready;
  assert.equal(restored.list().length, 1);
  restored.send("legacy", "After restart");
  await settled(restored);
  assert.equal(requests[2].threadId, "codex-legacy");
  assert(requests[2].input.some((m) => m.content.includes("App restarted")));
  assert(!requests[2].input.some((m) => m.content === "Earlier goal"));
  restored.close();

  // Crash/stop after a user message is persisted but before turn/start accepts
  // it. The provider thread already exists, which was the lossy restart case.
  const pendingRequests = [];
  let waitingForAcceptance;
  const reachedProvider = new Promise((resolve) => {
    waitingForAcceptance = resolve;
  });
  const delayedClient = {
    close() {},
    async run(turn) {
      waitingForAcceptance();
      await new Promise((_, reject) => {
        turn.signal.addEventListener(
          "abort",
          () => reject(turn.signal.reason),
          { once: true },
        );
        if (turn.signal.aborted) reject(turn.signal.reason);
      });
    },
  };
  const interrupted = new AgentRuntime({ ...options, client: delayedClient });
  await interrupted.ready;
  const before = (await store.load())[0].codexDelivery.acceptedMessageId;
  assert.deepEqual(
    interrupted.send("legacy", "Request saved before acceptance"),
    {},
  );
  await reachedProvider;
  await interrupted.flush();
  assert.equal((await store.load())[0].codexDelivery.acceptedMessageId, before);
  interrupted.close();
  await settled(interrupted);
  const pendingFile = await readFile(
    join(storageDirectory, "legacy.json"),
    "utf8",
  );
  const recoveryClient = {
    close() {},
    async run(turn) {
      pendingRequests.push(JSON.parse(turn.input));
      turn.onThread(turn.threadId);
      await turn.onAccepted();
    },
  };
  const recoveryOptions = {
    ...options,
    client: recoveryClient,
    browser: { tabs: () => ({ tabs: [], activeTabId: null }) },
  };
  const recovered = new AgentRuntime(recoveryOptions);
  await recovered.ready;
  const unconfirmed = recovered.list()[0];
  assert.equal(unconfirmed.status, "waiting");
  assert.match(unconfirmed.pending.question, /Delivery of 1 saved message/);
  assert(
    unconfirmed.messages.some(
      (m) => m.text === "Request saved before acceptance",
    ),
  );
  assert.equal(
    pendingRequests.length,
    0,
    "Restoring must never retry a request automatically",
  );
  assert(recovered.send("legacy", "Bypass recovery").error);
  assert(
    (await recovered.resume("legacy", unconfirmed.pending.id, "Done")).error,
  );
  assert.deepEqual(
    await recovered.resume(
      "legacy",
      unconfirmed.pending.id,
      "Resend saved messages",
    ),
    {},
  );
  await settled(recovered);
  assert(
    pendingRequests[0].some(
      (m) => m.content === "Request saved before acceptance",
    ),
  );
  assert(!pendingRequests[0].some((m) => m.content === "Earlier goal"));
  recovered.close();
  const acceptedAgain = new AgentRuntime(recoveryOptions);
  await acceptedAgain.ready;
  assert.equal(
    acceptedAgain.list()[0].pending,
    null,
    "Acknowledged messages must not be offered for resend again",
  );
  acceptedAgain.close();

  // Restore the same unconfirmed snapshot and choose to retain without resend.
  await writeFile(join(storageDirectory, "legacy.json"), pendingFile);
  const dismiss = new AgentRuntime({ ...recoveryOptions, client: null });
  await dismiss.ready;
  const keep = dismiss.list()[0];
  assert.deepEqual(
    await dismiss.resume("legacy", keep.pending.id, "Keep in chat only"),
    {},
  );
  await dismiss.flush();
  assert.equal(pendingRequests.length, 1, "Dismissal must not call Codex");
  assert.equal(
    (await store.load())[0].codexDelivery.acceptedMessageId,
    before,
    "Dismissal is not a Codex acknowledgement",
  );
  dismiss.close();
  const dismissed = new AgentRuntime(recoveryOptions);
  await dismissed.ready;
  assert.equal(dismissed.list()[0].pending, null);
  assert(
    dismissed
      .list()[0]
      .messages.some((m) => m.text === "Request saved before acceptance"),
  );
  assert.deepEqual(dismissed.send("legacy", "A different request"), {});
  await settled(dismissed);
  assert(
    !pendingRequests[1].some(
      (m) => m.content === "Request saved before acceptance",
    ),
  );
  assert(
    pendingRequests[1].some((m) =>
      m.content.includes("Do not retry dismissed requests"),
    ),
  );
  dismissed.close();

  // An accepted turn interrupted before an assistant reply is still delivered.
  // Assistant output ordering/length must not be used as the boundary.
  const acceptedStore = (await store.load())[0];
  assert.equal(acceptedStore.chat.messages.at(-1).role, "user");
  acceptedStore.chat.status = "running";
  await store.save(acceptedStore);
  const acceptedRestart = new AgentRuntime(recoveryOptions);
  await acceptedRestart.ready;
  assert.equal(acceptedRestart.list()[0].pending, null);
  assert.equal(acceptedRestart.list()[0].status, "stopped");
  acceptedRestart.close();

  // Old Codex snapshots have no acknowledgement record: ask rather than infer
  // every saved message was received. Legacy SDK migration remains covered above.
  const oldSnapshot = JSON.parse(pendingFile);
  delete oldSnapshot.codexDelivery;
  await writeFile(
    join(storageDirectory, "legacy.json"),
    JSON.stringify(oldSnapshot),
  );
  const oldCodex = new AgentRuntime(recoveryOptions);
  await oldCodex.ready;
  assert.equal(oldCodex.list()[0].status, "waiting");
  assert(oldCodex.list()[0].pending.choices.includes("Keep in chat only"));
  oldCodex.close();
  console.log(
    "Codex: protocol, tool routing, interrupt, login errors, persistence, migration and isolation passed.",
  );
} finally {
  provider.close();
  await rm(root, { recursive: true, force: true });
}
