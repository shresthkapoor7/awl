import assert from "node:assert/strict";
import { mkdtemp, copyFile, chmod, readFile, rm } from "node:fs/promises";
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
      turn.onAccepted();
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
  console.log(
    "Codex: protocol, tool routing, interrupt, login errors, persistence, migration and isolation passed.",
  );
} finally {
  provider.close();
  await rm(root, { recursive: true, force: true });
}
