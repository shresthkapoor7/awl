import { targetSchema } from "../../shared/target.js";
import { z } from "zod";
import { mkdir, readdir, writeFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { defineTool, ToolError } from "./core.cjs";
const name = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
const field = z.strictObject({
  name,
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().min(1).max(300),
});
export const legacyCapabilitySchema = z.strictObject({
  id: name,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  origin: z.string().min(1).max(500),
  expected_version: z.number().int().min(0).max(9999),
  inputs: z.array(field).max(20),
  outputs: z.array(field).min(1).max(20),
  steps: z
    .array(
      z.strictObject({
        operation: z.enum([
          "navigate",
          "click",
          "fill",
          "select",
          "press",
          "assert_text",
          "extract_text",
        ]),
        selector: z.string().max(500).nullable(),
        input: name.nullable(),
        value: z.string().max(1000).nullable(),
        output: name.nullable(),
      }),
    )
    .min(2)
    .max(60),
  on_unknown_state: z.literal("pause_for_human"),
});
export const capabilitySchema = legacyCapabilitySchema.extend({
  steps: z
    .array(
      legacyCapabilitySchema.shape.steps.element.extend({
        target: targetSchema.nullable(),
      }),
    )
    .min(2)
    .max(60),
});
export type CapabilityDraft = z.infer<typeof capabilitySchema>;
export function validateCapability(draft: CapabilityDraft) {
  let origin: URL;
  try {
    origin = new URL(draft.origin);
  } catch {
    throw new ToolError("INVALID_CAPABILITY", "Use an HTTP(S) origin.");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== draft.origin ||
    origin.username ||
    origin.password
  )
    throw new ToolError(
      "INVALID_CAPABILITY",
      "origin must be an HTTP(S) origin without credentials, path, query, or fragment.",
    );
  const inputs = new Set(draft.inputs.map((item) => item.name));
  const outputs = new Set(draft.outputs.map((item) => item.name));
  if (
    inputs.size !== draft.inputs.length ||
    outputs.size !== draft.outputs.length
  )
    throw new ToolError(
      "INVALID_CAPABILITY",
      "Input and output names must be unique within each list.",
    );
  if (
    [...inputs, ...outputs].some((item) =>
      /password|secret|token|credential|api_key|otp|card_number/i.test(item),
    )
  )
    throw new ToolError(
      "INVALID_CAPABILITY",
      "Credentials and authentication values do not belong in capabilities.",
    );
  const assigned = new Set<string>();
  for (const step of draft.steps) {
    if (step.input && !inputs.has(step.input))
      throw new ToolError(
        "INVALID_CAPABILITY",
        "A step references an undeclared input.",
      );
    if (step.output && (!outputs.has(step.output) || assigned.has(step.output)))
      throw new ToolError(
        "INVALID_CAPABILITY",
        "Every output must be declared and assigned exactly once.",
      );
    if (step.output) assigned.add(step.output);
    if (step.operation === "navigate") {
      let url: URL;
      try {
        url = new URL(step.value ?? "");
      } catch {
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Navigation requires an absolute URL.",
        );
      }
      if (
        url.origin !== draft.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        step.selector ||
        step.target ||
        step.input ||
        step.output
      )
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Navigation must stay on the declared origin and omit credentials, queries, fragments, and unrelated fields.",
        );
    } else {
      if (!step.selector?.trim() && !step.target)
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Each non-navigation step needs an observed target.",
        );
      if (["fill", "select"].includes(step.operation)) {
        if (!step.input || step.value !== null || step.output)
          throw new ToolError(
            "INVALID_CAPABILITY",
            "Fill/select must reference a declared input, with no recorded literal value or output.",
          );
      } else if (step.input)
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Only fill/select steps consume inputs.",
        );
      if (
        step.operation === "extract_text" &&
        (!step.output || step.value !== null)
      )
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Extraction requires an output and no literal value.",
        );
      if (step.operation !== "extract_text" && step.output)
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Only extract_text assigns an output.",
        );
      if (step.operation === "assert_text" && !step.value?.trim())
        throw new ToolError(
          "INVALID_CAPABILITY",
          "A text checkpoint requires expected visible text.",
        );
      if (step.operation === "click" && step.value !== null)
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Click does not accept a value.",
        );
      if (
        step.operation === "press" &&
        !["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].includes(
          step.value ?? "",
        )
      )
        throw new ToolError(
          "INVALID_CAPABILITY",
          "Use a supported key for press.",
        );
    }
  }
  if (assigned.size !== outputs.size)
    throw new ToolError(
      "INVALID_CAPABILITY",
      "All declared outputs need an extraction step.",
    );
  if (
    draft.steps[0].operation !== "navigate" ||
    draft.steps.at(-1)?.operation !== "assert_text"
  )
    throw new ToolError(
      "INVALID_CAPABILITY",
      "Start with navigation and finish with an explicit text checkpoint.",
    );
  if (draft.outputs.some((item) => item.type !== "string"))
    throw new ToolError(
      "INVALID_CAPABILITY",
      "extract_text currently produces string outputs only.",
    );
}
export const capabilityWrite = defineTool(
  "capability_write",
  "Save a parameterized capability draft learned from observed browser steps. expected_version=0 creates v1; use the returned version for updates. Declare inputs/outputs, observed target descriptions from browser_dom, an initial navigation and final assert_text checkpoint. All nullable fields must be provided. Fill/select reference input names instead of storing entered values. Use each observed target object including its frame and shadow scope. Set selector=null when providing target; keep target=null for navigation. CSS selectors are supported as a main-document fallback. Credentials must never be recorded. This saves a validated draft, not an executable or replay-validated workflow.",
  capabilitySchema,
  async (draft, context) => {
    validateCapability(draft);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(context.agentId))
      throw new ToolError("INVALID_SESSION", "Invalid chat identity.");
    context.signal.throwIfAborted();
    const directory = join(
      context.artifactDirectory,
      context.agentId,
      draft.id,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const versions = (await readdir(directory))
      .filter((file) => /^v\d+\.json$/.test(file))
      .map((file) => Number(file.slice(1, -5)));
    const current = Math.max(0, ...versions);
    if (current !== draft.expected_version)
      throw new ToolError(
        "VERSION_CONFLICT",
        `Current version is ${current}. Inspect the saved draft before updating.`,
      );
    const version = current + 1;
    const artifact = {
      schema_version: 2,
      ...draft,
      version,
      status: "draft",
      source_chat_id: context.agentId,
      created_at: new Date().toISOString(),
    };
    const content = JSON.stringify(artifact, null, 2) + "\n";
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
      context.signal.throwIfAborted();
      try {
        await link(temporary, join(directory, `v${version}.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new ToolError(
            "VERSION_CONFLICT",
            "Another write saved this version. Read the current draft first.",
          );
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return {
      data: {
        id: draft.id,
        version,
        status: "draft",
        sha256: createHash("sha256").update(content).digest("hex"),
        executable: false,
      },
    };
  },
);
