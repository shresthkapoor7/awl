import {
  app,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { join } from "node:path";
import OpenAI from "openai";
import { readCapabilityCatalog } from "./capability-catalog.cjs";
import { AgentRuntime, TERRA_MODEL } from "./agent-runtime.cjs";
import type { BrowserAccess } from "./tools/core.cjs";
export function installAgent(window: BrowserWindow, browser: BrowserAccess) {
  const enabled = process.env.AWL_AI_DISABLED !== "1";
  let local: Record<string, string | undefined> = {};
  if (enabled) {
    try {
      local = parseEnv(readFileSync(join(app.getAppPath(), ".env"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const key = process.env.OPENAI_API_KEY || local.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || local.OPENAI_MODEL || TERRA_MODEL;
  const runtime = new AgentRuntime({
    client:
      enabled && key
        ? new OpenAI({ apiKey: key, timeout: 60000, maxRetries: 0 })
        : null,
    model,
    storageDirectory: enabled
      ? join(app.getPath("userData"), "workspace")
      : undefined,
    browser,
    directory: join(app.getPath("userData"), "capabilities"),
    publish: (chat) => {
      if (!window.isDestroyed()) window.webContents.send("agent:update", chat);
    },
  });
  function authorize(event: IpcMainInvokeEvent) {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Agent access is restricted to the awl workspace.");
  }
  ipcMain.handle("agent:state", async (event) => {
    authorize(event);
    await runtime.ready;
    return { enabled, model, chats: runtime.list() };
  });
  ipcMain.handle("agent:create", async (event, id) => {
    authorize(event);
    await runtime.ready;
    if (typeof id !== "string") return { error: "Invalid chat identity." };
    const result = runtime.create(id);
    return "status" in result ? { chat: result } : result;
  });
  ipcMain.handle("agent:capabilities", async (event) => {
    authorize(event);
    await runtime.ready;
    try {
      return {
        drafts: await readCapabilityCatalog(
          join(app.getPath("userData"), "capabilities"),
        ),
      };
    } catch {
      return { drafts: [], error: "Could not read saved capabilities." };
    }
  });
  ipcMain.handle("agent:delete-session", async (event, id) => {
    authorize(event);
    await runtime.ready;
    return typeof id === "string"
      ? runtime.deleteSession(id)
      : { error: "Invalid session." };
  });
  ipcMain.handle("agent:send", async (event, input) => {
    authorize(event);
    await runtime.ready;
    if (!enabled) return { error: "AI is disabled in this test session." };
    if (
      !input ||
      typeof input.id !== "string" ||
      typeof input.text !== "string"
    )
      return { error: "Invalid chat request." };
    return runtime.send(input.id, input.text);
  });
  ipcMain.handle("agent:delete-capability", async (event, ref) => {
    authorize(event);
    await runtime.ready;
    if (
      !ref ||
      typeof ref !== "object" ||
      typeof ref.id !== "string" ||
      typeof ref.sourceChatId !== "string" ||
      !Number.isInteger(ref.version)
    )
      return { error: "Invalid capability." };
    return runtime.deleteCapability(ref);
  });
  ipcMain.handle("agent:stop", async (event, id) => {
    authorize(event);
    await runtime.ready;
    if (typeof id === "string") runtime.stop(id);
  });
  ipcMain.handle("agent:takeover", async (event, id) => {
    authorize(event);
    await runtime.ready;
    return typeof id === "string"
      ? runtime.takeover(id)
      : { error: "Invalid chat." };
  });
  ipcMain.handle("agent:resume", async (event, input) => {
    authorize(event);
    await runtime.ready;
    if (
      !input ||
      typeof input.id !== "string" ||
      typeof input.requestId !== "string" ||
      typeof input.answer !== "string"
    )
      return { error: "Invalid resume request." };
    return runtime.resume(input.id, input.requestId, input.answer);
  });
  ipcMain.handle("agent:launch", async (event, input) => {
    authorize(event);
    await runtime.ready;
    if (
      !input ||
      !input.ref ||
      typeof input.ref !== "object" ||
      !input.inputs ||
      typeof input.inputs !== "object" ||
      typeof input.validation !== "boolean"
    )
      return { error: "Invalid launch request." };
    return runtime.launch(input.ref, input.inputs, input.validation);
  });
  ipcMain.handle("agent:repair", async (event, id) => {
    authorize(event);
    await runtime.ready;
    return typeof id === "string"
      ? runtime.repair(id)
      : { error: "Invalid chat." };
  });
  ipcMain.handle("agent:record", async (event, input) => {
    authorize(event);
    await runtime.ready;
    if (
      !input ||
      typeof input.id !== "string" ||
      typeof input.action !== "string" ||
      (input.stepId !== undefined && typeof input.stepId !== "string") ||
      (input.parameters !== undefined &&
        (!input.parameters ||
          typeof input.parameters !== "object" ||
          Object.keys(input.parameters).length > 200 ||
          Object.values(input.parameters).some(
            (value) => typeof value !== "string",
          )))
    )
      return { error: "Invalid recording request." };
    return runtime.record(
      input.id,
      input.action,
      input.stepId,
      input.parameters,
    );
  });
  let quitting = false;
  const beforeQuit = (event: Electron.Event) => {
    if (quitting || !enabled) return;
    event.preventDefault();
    quitting = true;
    runtime.close();
    void runtime
      .flush()
      .catch(() => {})
      .finally(() => app.quit());
  };
  app.on("before-quit", beforeQuit);
  window.once("closed", () => {
    runtime.close();
    void runtime
      .flush()
      .finally(() => app.removeListener("before-quit", beforeQuit))
      .catch(() => {});
    for (const name of [
      "agent:state",
      "agent:create",
      "agent:delete-session",
      "agent:delete-capability",
      "agent:capabilities",
      "agent:send",
      "agent:stop",
      "agent:takeover",
      "agent:resume",
      "agent:record",
      "agent:launch",
      "agent:repair",
    ])
      ipcMain.removeHandler(name);
  });
}
