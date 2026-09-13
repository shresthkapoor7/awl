import { readFile, writeFile, rename, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  capabilitySchema,
  legacyCapabilitySchema,
  validateCapability,
  type CapabilityDraft,
} from "./tools/capability-write.cjs";
import { browserAction } from "./tools/browser-action.cjs";
import { resolveTarget } from "./targeting.cjs";
import {
  ToolError,
  toolSignal,
  abortable,
  type ToolContext,
} from "./tools/core.cjs";
import type { Target } from "../shared/target.js";
import type { ExecutionState, CapabilityRef } from "../shared/agent.js";

export function capabilityPath(root: string, ref: CapabilityRef) {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(ref.sourceChatId) ||
    !/^[a-z][a-z0-9_]{0,59}$/.test(ref.id) ||
    !Number.isInteger(ref.version) ||
    ref.version < 1 ||
    ref.version > 10000
  )
    throw new Error("Invalid capability identity.");
  return join(root, ref.sourceChatId, ref.id, `v${ref.version}`);
}
export async function loadCapability(root: string, ref: CapabilityRef) {
  const path = capabilityPath(root, ref);
  const stat = await lstat(path + ".json");
  if (!stat.isFile() || stat.size > 128000)
    throw new Error("Invalid capability artifact.");
  const content = await readFile(path + ".json", "utf8");
  const {
    version,
    status,
    source_chat_id,
    schema_version,
    created_at: _,
    ...raw
  } = JSON.parse(content);
  if (
    version !== ref.version ||
    source_chat_id !== ref.sourceChatId ||
    raw.id !== ref.id ||
    status !== "draft" ||
    ![1, 2].includes(schema_version)
  )
    throw new Error("Capability identity does not match.");
  const draft =
    schema_version === 1
      ? capabilitySchema.parse({
          ...legacyCapabilitySchema.parse(raw),
          steps: raw.steps.map((step: object) => ({ ...step, target: null })),
        })
      : capabilitySchema.parse(raw);
  validateCapability(draft);
  return {
    draft,
    hash: createHash("sha256").update(content).digest("hex"),
    path,
  };
}
type Validation = {
  hash: string;
  status: "draft" | "validated" | "failed";
  cases: string[];
  at: string;
};
export async function validationState(
  path: string,
  hash: string,
): Promise<Validation | null> {
  try {
    const value = JSON.parse(await readFile(path + ".validation.json", "utf8"));
    return value.hash === hash &&
      ["draft", "validated", "failed"].includes(value.status) &&
      Array.isArray(value.cases)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function compile(draft: CapabilityDraft) {
  validateCapability(draft);
  // The executable plan is closed over seven operations. Artifact text is reviewable;
  // the executor uses the validated plan directly and never evaluates artifact JS.
  return {
    plan: structuredClone(draft.steps),
    code: `// awl constrained capability; driver has no API, shell, or filesystem access.\nexport default async function run(driver, inputs) {\n${draft.steps.map((step, index) => `  await driver.step(${index}, ${JSON.stringify(step)}, inputs);`).join("\n")}\n  return driver.outputs();\n}\n`,
  };
}
export function bindInputs(
  draft: CapabilityDraft,
  values: Record<string, unknown>,
) {
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.keys(values).some(
      (key) => !draft.inputs.some((field) => field.name === key),
    )
  )
    throw new Error("Unknown capability input.");
  for (const field of draft.inputs)
    if (
      typeof values[field.name] !== field.type ||
      String(values[field.name]).length > 1000 ||
      (field.type === "number" && !Number.isFinite(values[field.name]))
    )
      throw new Error(`Provide a ${field.type} for ${field.name}.`);
  return structuredClone(values) as Record<string, string | number | boolean>;
}
const cssTarget = (value: string): Target => ({
  kind: "css",
  value,
  role: null,
  frame: null,
  shadow: [],
  within: null,
});
export class Execution {
  readonly state: ExecutionState;
  readonly plan: ReturnType<typeof compile>;
  private tabId: string | null = null;
  private uncertain = false;
  constructor(
    readonly artifact: Awaited<ReturnType<typeof loadCapability>>,
    ref: CapabilityRef,
    inputs: Record<string, unknown>,
    validation: boolean,
    private context: Omit<ToolContext, "signal">,
    private changed: () => void,
  ) {
    this.plan = compile(artifact.draft);
    this.state = {
      ...ref,
      step: 0,
      total: this.plan.plan.length,
      status: "running",
      validation,
      inputs: bindInputs(artifact.draft, inputs),
      outputs: {},
      error: null,
      uncertain: false,
    };
  }
  async run(signal: AbortSignal, confirmCompleted = false) {
    if (this.state.status === "completed")
      throw new Error("This run is already complete.");
    if (this.state.uncertain && !confirmCompleted)
      throw new Error(
        "Check the uncertain action and confirm it completed before continuing.",
      );
    if (confirmCompleted && this.state.uncertain) this.state.step++;
    this.state.status = "running";
    this.state.error = null;
    this.state.uncertain = false;
    this.changed();
    try {
      for (; this.state.step < this.plan.plan.length;) {
        signal.throwIfAborted();
        this.uncertain = false;
        const step = this.plan.plan[this.state.step];
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        await toolSignal.run(deadline, () =>
          abortable(this.step(step, deadline), deadline),
        );
        this.state.step++;
        this.uncertain = false;
        signal.throwIfAborted();
        this.changed();
      }
      // Project outputs only after the final checkpoint; an earlier placeholder is not the result.
      for (const step of this.plan.plan.filter(
        (step) => step.operation === "extract_text",
      )) {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        await toolSignal.run(deadline, () =>
          abortable(this.step(step, deadline), deadline),
        );
      }
      signal.throwIfAborted();
      this.state.status = "completed";
      if (this.state.validation) await this.saveValidation(true);
    } catch (error) {
      this.state.status = "paused";
      this.state.uncertain = this.uncertain;
      this.state.error = signal.aborted
        ? "Run stopped. Check the page before continuing."
        : error instanceof ToolError
          ? `${error.code}: ${error.message}`
          : "Step could not finish. Check the current page.";
      if (this.state.validation) await this.saveValidation(false);
    }
    this.changed();
  }
  private async step(
    step: CapabilityDraft["steps"][number],
    signal: AbortSignal,
  ) {
    const ctx = { ...this.context, signal };
    if (step.operation === "navigate") {
      const state = await ctx.browser.start(
        ctx.agentId,
        step.value!,
        this.tabId,
        signal,
      );
      this.tabId = state.activeTabId;
      const wc = ctx.browser.target(ctx.agentId, this.tabId);
      if (wc.isLoading())
        await abortable(
          new Promise<void>((resolve) =>
            wc.once("did-stop-loading", () => resolve()),
          ),
          signal,
        );
      if (new URL(wc.getURL()).origin !== this.artifact.draft.origin)
        throw new ToolError(
          "ORIGIN_CHANGED",
          "Navigation left the capability origin. Check authentication before continuing.",
        );
      return;
    }
    if (!this.tabId)
      throw new ToolError("TAB_NOT_FOUND", "The execution tab is unavailable.");
    const wc = ctx.browser.target(ctx.agentId, this.tabId);
    if (new URL(wc.getURL()).origin !== this.artifact.draft.origin)
      throw new ToolError(
        "ORIGIN_CHANGED",
        "The browser left the capability origin.",
      );
    let observed: Awaited<ReturnType<typeof resolveTarget>>;
    // Only observations retry. Native input is dispatched once.
    for (;;) {
      signal.throwIfAborted();
      try {
        observed = await resolveTarget(
          wc,
          step.target ?? cssTarget(step.selector!),
        );
        if (
          step.operation === "assert_text" &&
          !observed.text.includes(step.value!)
        )
          throw new ToolError(
            "CHECKPOINT_MISSING",
            "The expected result is not visible.",
          );
        break;
      } catch (error) {
        if (
          !(error instanceof ToolError) ||
          !["TARGET_MISSING", "CHECKPOINT_MISSING", "PAGE_CHANGED"].includes(
            error.code,
          )
        )
          throw error;
        await abortable(
          new Promise((resolve) => setTimeout(resolve, 150)),
          signal,
        );
      }
    }
    if (step.operation === "assert_text") return;
    if (step.operation === "extract_text") {
      this.state.outputs[step.output!] = observed.text;
      return;
    }
    this.uncertain = true;
    await browserAction.execute(
      {
        tab_id: this.tabId,
        frame_id: observed.frame_id,
        snapshot_id: observed.snapshot_id,
        ref: observed.ref,
        action: step.operation,
        value: step.input ? String(this.state.inputs[step.input]) : step.value,
      },
      ctx,
    );
  }
  private async saveValidation(success: boolean) {
    const prior = await validationState(this.artifact.path, this.artifact.hash);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          this.artifact.draft.inputs.map((field) => [
            field.name,
            this.state.inputs[field.name],
          ]),
        ),
      )
      .digest("hex");
    const cases = [
      ...new Set([
        ...(success ? (prior?.cases ?? []) : []),
        ...(success ? [fingerprint] : []),
      ]),
    ].slice(-20);
    const value: Validation = {
      hash: this.artifact.hash,
      status:
        success &&
        (this.artifact.draft.inputs.length === 0 || cases.length >= 2)
          ? "validated"
          : success
            ? "draft"
            : "failed",
      cases,
      at: new Date().toISOString(),
    };
    const tmp = this.artifact.path + `.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await rename(tmp, this.artifact.path + ".validation.json");
    await writeFile(this.artifact.path + ".mjs", this.plan.code, {
      mode: 0o600,
    });
  }
}
