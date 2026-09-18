#!/usr/bin/env node
// A local protocol peer for CI. Never starts Codex or calls a model.
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const scenario = basename(process.cwd());
const threadId = `${scenario}-thread`;
const turnId = "turn-1";
const send = (data) => process.stdout.write(JSON.stringify(data) + "\n");
const event = (method, params) =>
  send({ method, params: { threadId, turnId, ...params } });
const call = (id, params = {}) =>
  send({
    id,
    method: "item/tool/call",
    params: {
      threadId,
      turnId,
      callId: String(id),
      tool: "chat_set_name",
      arguments: { name: "Codex chat" },
      ...params,
    },
  });
const finish = (status = "completed") =>
  event("turn/completed", { turn: { id: turnId, status } });
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(join(process.cwd(), "protocol.jsonl"), line + "\n");
  const reply = (result) => send({ id: message.id, result });
  if (message.method === "initialize") return reply({ userAgent: "fixture" });
  if (message.method === "account/read")
    return reply({
      requiresOpenaiAuth: true,
      account: scenario === "login" ? null : { type: "chatgpt" },
    });
  if (message.method === "config/read")
    return reply({
      config: {
        mcp_servers: {
          external: { enabled: true },
          "external.with.dots": { enabled: true },
        },
      },
    });
  if (message.method === "thread/start" || message.method === "thread/resume") {
    if (scenario === "missing-thread")
      return send({
        id: message.id,
        error: { code: -32600, message: "Thread not found" },
      });
    return reply({ thread: { id: threadId } });
  }
  if (message.method === "turn/start") {
    if (scenario === "early") {
      event("item/completed", {
        item: { type: "agentMessage", id: "early", text: "Early message" },
      });
      finish();
      return reply({ turn: { id: turnId, status: "inProgress" } });
    }
    reply({ turn: { id: turnId, status: "inProgress" } });
    if (scenario === "exit") return process.exit(1);
    if (scenario === "failure") return finish("failed");
    if (scenario === "cancel") {
      setTimeout(() => call(100), 500);
      return;
    }
    if (scenario === "spoof") {
      call(99, { threadId: "not-this-thread" });
      return;
    }
    if (scenario === "unsupported") {
      send({
        id: 98,
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId, command: "must never run" },
      });
      return;
    }
    event("item/completed", {
      threadId: "unrelated",
      item: { type: "agentMessage", id: "other", text: "Unrelated" },
    });
    event("item/completed", {
      turnId: "old-turn",
      item: { type: "agentMessage", id: "old", text: "Stale" },
    });
    event("thread/tokenUsage/updated", {
      tokenUsage: { last: { inputTokens: 321 } },
    });
    event("item/completed", {
      item: { type: "contextCompaction", id: "compact" },
    });
    call(100);
    return;
  }
  if (message.method === "turn/interrupt") {
    reply({});
    finish("interrupted");
    return;
  }
  if (message.id === 98 || message.id === 99) {
    finish();
    return;
  }
  if (message.id === 100) {
    if (scenario === "stop" || scenario === "duplicate") {
      call(101, { callId: "100" });
      return;
    }
    event("item/completed", {
      item: { type: "agentMessage", id: "answer", text: "Done." },
    });
    finish();
  }
  if (message.id === 101) finish();
});
