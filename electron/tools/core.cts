import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import type { WebContents } from "electron";
import type { PendingQuestion } from "../../shared/agent.js";
import type { BrowserState } from "../../shared/browser.js";

export interface BrowserAccess {
  start(
    agentId: string,
    url: string,
    tabId: string | null,
    signal: AbortSignal,
  ): Promise<BrowserState>;
  tabs(
    agentId: string,
    action: "list" | "select" | "close",
    tabId: string | null,
  ): BrowserState;
  target(agentId: string, tabId: string): WebContents;
  onHumanInput?: (handler: (id: string) => void) => void;
  setOwner?: (id: string, owner: "human" | "agent") => void;
  removeSession?: (id: string) => Promise<void> | void;
}
export type ToolContext = {
  agentId: string;
  browser: BrowserAccess;
  rename: (name: string) => void;
  artifactDirectory: string;
  signal: AbortSignal;
  ask?: (request: Omit<PendingQuestion, "id">) => { request_id: string };
  complete?: (summary: string) => void;
  evidence?: (sequence: number) => unknown;
  event?: (
    kind: string,
    label: string,
    evidence?: import("../../shared/evidence.js").SafeEvidence,
  ) => void;
};
export type ToolOutput = { data: unknown; image?: string };
export const toolSignal = new AsyncLocalStorage<AbortSignal>();
export function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Tool = {
  name: string;
  description: string;
  schema: z.ZodType;
  execute: (args: unknown, context: ToolContext) => Promise<ToolOutput>;
};
export function defineTool<S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  execute: (args: z.infer<S>, context: ToolContext) => Promise<ToolOutput>,
): Tool {
  return {
    name,
    description,
    schema,
    execute: (args, context) => execute(schema.parse(args), context),
  };
}
export function toolDefinition(tool: Tool) {
  const { $schema: _, ...parameters } = z.toJSONSchema(tool.schema);
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    strict: true,
    parameters,
  };
}
export async function dispatch(tool: Tool, raw: string, context: ToolContext) {
  context.signal.throwIfAborted();
  if (raw.length > 64000)
    return {
      ok: false as const,
      error: { code: "INVALID_ARGUMENTS", message: "Arguments exceed 64 KB." },
    };
  try {
    const args = JSON.parse(raw);
    const output = await toolSignal.run(context.signal, () =>
      abortable(tool.execute(args, context), context.signal),
    );
    context.signal.throwIfAborted();
    return { ok: true as const, ...output };
  } catch (error) {
    if (context.signal.aborted) throw context.signal.reason;
    if (error instanceof z.ZodError)
      return {
        ok: false as const,
        error: {
          code: "INVALID_ARGUMENTS",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
            .slice(0, 2000),
        },
      };
    if (error instanceof SyntaxError)
      return {
        ok: false as const,
        error: {
          code: "INVALID_JSON",
          message: "Provide a JSON object matching the tool schema.",
        },
      };
    if (error instanceof ToolError)
      return {
        ok: false as const,
        error: { code: error.code, message: error.message },
      };
    return {
      ok: false as const,
      error: {
        code: "TOOL_FAILED",
        message:
          "The operation failed. Inspect the current page before retrying; an action may already have occurred.",
      },
    };
  }
}
export const tabIdSchema = z.string().min(1).max(80);
