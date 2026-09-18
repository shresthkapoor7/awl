import { sessionSettingsSchema } from "../shared/session-settings.js";
import { z } from "zod";
import { safeEvidenceSchema } from "../shared/evidence.js";
import { executionResultSchema } from "../shared/execution.js";
import { targetSchema } from "../shared/target.js";
import type { StoredSession } from "./workspace-store.cjs";

const id = z.string().min(1);
const sessionId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const count = z.number().int().nonnegative();
const content = z.union([
  z.looseObject({ type: z.literal("input_text"), text: z.string() }),
  z.looseObject({
    type: z.literal("output_text"),
    text: z.string(),
    annotations: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  z.looseObject({ type: z.literal("refusal"), refusal: z.string() }),
  z.looseObject({
    type: z.literal("input_image"),
    image_url: z.string().nullable().optional(),
    file_id: z.string().nullable().optional(),
    detail: z.enum(["auto", "low", "high"]),
  }),
]);
// Accept legacy Responses histories so existing awl sessions can migrate.
const historyItem = z.union([
  z.looseObject({
    type: z.literal("message").optional(),
    role: z.enum(["user", "assistant", "system", "developer"]),
    content: z.union([z.string(), z.array(content)]),
  }),
  z.looseObject({
    type: z.literal("function_call"),
    call_id: id,
    name: id,
    arguments: z.string(),
  }),
  z.looseObject({
    type: z.literal("function_call_output"),
    call_id: id,
    output: z.union([z.string(), z.array(content)]),
  }),
  z.looseObject({
    type: z.literal("reasoning"),
    id,
    summary: z.array(
      z.looseObject({ type: z.literal("summary_text"), text: z.string() }),
    ),
    encrypted_content: z.string().nullable().optional(),
    content: z
      .array(
        z.looseObject({ type: z.literal("reasoning_text"), text: z.string() }),
      )
      .optional(),
  }),
  z.looseObject({
    type: z.literal("compaction"),
    id,
    encrypted_content: z.string(),
  }),
]);
export type SessionHistory = z.infer<typeof historyItem>[];
const storedSession = z.object({
  codexThreadId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,160}$/)
    .optional(),
  version: z.literal(1),
  chat: z.looseObject({
    id: sessionId,
    settings: sessionSettingsSchema.optional(),
    createdAt: z.number().nonnegative().optional(),
    name: z.string(),
    status: z.enum([
      "idle",
      "running",
      "waiting",
      "completed",
      "error",
      "stopped",
    ]),
    error: z.string().nullable(),
    messages: z.array(
      z.object({
        id,
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        model: z.string().max(160).optional(),
      }),
    ),
    tools: z.array(
      z.object({
        id,
        name: z.string(),
        state: z.enum(["running", "done", "error"]),
        detail: z.string().optional(),
      }),
    ),
    control: z
      .object({
        owner: z.enum(["human", "agent"]),
        capture: z.enum(["private", "observe", "recording"]),
        generation: count,
      })
      .optional(),
    pending: z
      .object({
        id,
        reason: z.enum([
          "authentication",
          "clarification",
          "demonstration",
          "unexpected_state",
        ]),
        question: z.string(),
        choices: z.array(z.string()),
        expected_text: z.string().nullable(),
      })
      .nullable()
      .optional(),
    demonstration: z
      .object({
        mode: z.enum(["off", "recording", "paused", "review"]),
        notice: z.string().nullable(),
        steps: z.array(
          z.object({
            id,
            at: z.string(),
            operation: z.enum([
              "navigate",
              "click",
              "fill",
              "select",
              "press",
              "gap",
            ]),
            target: targetSchema.nullable(),
            value: z.string().nullable(),
            url: z.string().nullable(),
            tab: count,
            outcome: z.string(),
          }),
        ),
      })
      .optional(),
    execution: z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
        sourceChatId: sessionId,
        version: z.number().int().min(1).max(10000),
        step: count,
        total: count,
        status: z.enum(["running", "paused", "completed"]),
        validation: z.boolean(),
        inputs: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
        outputs: z.record(z.string(), z.string()),
        error: z.string().nullable(),
        uncertain: z.boolean(),
        result: executionResultSchema.nullable().optional(),
      })
      .refine((run) => run.step <= run.total)
      .optional(),
    mode: z.enum(["discovery", "execution", "repair"]).optional(),
    journal: z
      .array(
        z.object({
          sequence: count,
          at: z.string(),
          actor: z.enum(["agent", "human", "runtime"]),
          kind: z.string(),
          label: z.string(),
          data: z.unknown().optional(),
          image: z.string().optional(),
          evidence: safeEvidenceSchema.optional(),
        }),
      )
      .optional(),
    contextTokens: z.number().nonnegative().optional(),
  }),
  history: z.array(historyItem),
});

export function parseStoredSession(value: unknown): StoredSession | null {
  const parsed = storedSession.safeParse(value);
  if (!parsed.success) return null;
  return {
    codexThreadId: parsed.data.codexThreadId,
    chat: parsed.data.chat,
    history: parsed.data.history,
  } as StoredSession;
}
