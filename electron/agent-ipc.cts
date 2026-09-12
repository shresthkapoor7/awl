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
  ipcMain.handle("agent:state", (event) => {
    authorize(event);
    return { enabled, model, chats: runtime.list() };
  });
  ipcMain.handle("agent:send", (event, input) => {
    authorize(event);
    if (!enabled) return { error: "AI is disabled in this test session." };
    if (
      !input ||
      typeof input.id !== "string" ||
      typeof input.text !== "string"
    )
      return { error: "Invalid chat request." };
    return runtime.send(input.id, input.text);
  });
  ipcMain.handle("agent:stop", (event, id) => {
    authorize(event);
    if (typeof id === "string") runtime.stop(id);
  });
  window.once("closed", () => {
    runtime.close();
    for (const name of ["agent:state", "agent:send", "agent:stop"])
      ipcMain.removeHandler(name);
  });
}
