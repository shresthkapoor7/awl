import { readFile, writeFile, rename, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  parseCapability,
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
import { bindTarget, bindText } from "../shared/bindings.js";
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
    ![1, 2, 3].includes(schema_version)
  )
    throw new Error("Capability identity does not match.");
  const draft = parseCapability(schema_version, raw);
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
const validationWrites = new Map<string, Promise<void>>();
async function serializeValidation(path: string, update: () => Promise<void>) {
  const operation = (validationWrites.get(path) ?? Promise.resolve())
    .catch(() => {})
    .then(update);
  validationWrites.set(path, operation);
  try {
    await operation;
  } finally {
    if (validationWrites.get(path) === operation) validationWrites.delete(path);
  }
}
class BusinessOutcome extends Error {}
export class Execution {
  readonly state: ExecutionState;
  readonly plan: ReturnType<typeof compile>;
  private tabId: string | null = null;
  private uncertain = false;
  private recoveryCounts = new Map<string, number>();
  private observedState = "No matching state observed.";
  private filled = new Map<string, string>();
  private lastObservation: ToolError | null = null;
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
      result: null,
    };
  }
  async run(signal: AbortSignal, confirmCompleted = false) {
    if (this.state.status === "completed")
      throw new Error("This run is already complete.");
    if (this.state.uncertain && !confirmCompleted)
      throw new Error(
        "Check the uncertain action and confirm it completed before continuing.",
      );
    const manual = this.state.result?.kind === "failure" && this.state.result.code === "RISKY_ACTION";
    if (manual && !confirmCompleted)
      throw new Error("Complete the blocked action directly, then confirm it completed.");
    if (confirmCompleted && (this.state.uncertain || manual)) {
      const next = this.plan.plan[this.state.step + 1];
      if (!this.tabId || !next || next.operation === "navigate")
        throw new Error("No observable continuation checkpoint. Enter Repair instead of guessing.");
      const target = bindTarget(next.target ?? cssTarget(next.selector!), this.state.inputs);
      const observed = await resolveTarget(this.context.browser.target(this.context.agentId, this.tabId), target);
      if (next.operation === "assert_text" && !observed.text.includes(bindText(next.value!, this.state.inputs)))
        throw new Error("The continuation checkpoint has not been reached.");
      this.state.step++;
    }
    this.state.status = "running";
    this.state.error = null;
    this.state.result = null;
    this.state.uncertain = false;
    this.changed();
    try {
      for (; this.state.step < this.plan.plan.length;) {
        signal.throwIfAborted();
        this.uncertain = false;
        this.lastObservation = null;
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
        this.lastObservation = null;
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        await toolSignal.run(deadline, () =>
          abortable(this.step(step, deadline), deadline),
        );
      }
      signal.throwIfAborted();
      this.state.status = "completed";
      this.state.result = { kind: "success", outputs: { ...this.state.outputs } };
      if (this.state.validation) await this.saveValidation(true);
    } catch (error) {
      if (error instanceof BusinessOutcome) {
        this.state.status = "completed";
        this.state.outputs = {};
        this.changed();
        return;
      }
      this.state.status = "paused";
      this.state.uncertain = this.uncertain;
      this.state.error = signal.aborted
        ? "Run stopped. Check the page before continuing."
        : error instanceof ToolError
          ? `${error.code}: ${error.message}`
          : this.lastObservation
            ? `${this.lastObservation.code}: ${this.lastObservation.message} Timed out waiting for step ${this.state.step + 1}.`
            : "Step could not finish. Check the current page.";
      const failedStep = this.plan.plan[Math.min(this.state.step, this.plan.plan.length - 1)];
      this.state.result = {
        kind: "failure",
        code: signal.aborted ? "RUN_STOPPED" : error instanceof ToolError ? error.code : this.lastObservation?.code ?? "STEP_FAILED",
        message: this.state.error,
        step: this.state.step,
        expected: `${failedStep.operation}: ${failedStep.value ?? failedStep.target?.value ?? failedStep.selector ?? "declared target"}`,
        observed: this.observedState,
        uncertain: this.state.uncertain,
      };
      this.state.outputs = {};
      if (this.state.validation) await this.saveValidation(false);
    }
    this.changed();
  }
  private async step(
    rawStep: CapabilityDraft["steps"][number],
    signal: AbortSignal,
  ): Promise<void> {
    const step = {
      ...rawStep,
      target: rawStep.target ? bindTarget(rawStep.target, this.state.inputs) : null,
      selector: rawStep.selector ? bindText(rawStep.selector, this.state.inputs, true) : null,
      value: rawStep.operation === "assert_text" && rawStep.value ? bindText(rawStep.value, this.state.inputs) : rawStep.value,
    };
    const ctx = { ...this.context, signal };
    if (step.operation === "navigate") {
      this.filled.clear();
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
        if (await this.handleState(signal)) continue;
        observed = await resolveTarget(
          wc,
          step.target ?? cssTarget(step.selector!),
        );
        this.observedState = observed.text.slice(0, 2000);
        if (
          step.operation === "assert_text" &&
          !observed.text.includes(step.value!)
        )
          throw new ToolError(
            "CHECKPOINT_MISSING",
            "The expected result is not visible.",
          );
        this.lastObservation = null;
        break;
      } catch (error) {
        if (
          !(error instanceof ToolError) ||
          !["TARGET_MISSING", "FRAME_MISSING", "CHECKPOINT_MISSING", "PAGE_CHANGED"].includes(
            error.code,
          )
        )
          throw error;
        this.lastObservation = error;
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
    const fieldKey = JSON.stringify(step.target ?? cssTarget(step.selector!));
    if (
      step.operation === "press" &&
      this.filled.has(fieldKey) &&
      observed.inputValue !== this.filled.get(fieldKey)
    )
      throw new ToolError(
        "FIELD_VALUE_CHANGED",
        "The field no longer contains the text entered by this run. The page may have reloaded or replaced it. Check the field before submitting.",
      );
    this.uncertain = true;
    try {
      await browserAction.execute(
        {
          tab_id: this.tabId,
          frame_id: observed.frame_id,
          snapshot_id: observed.snapshot_id,
          ref: observed.ref,
          action: step.operation,
          value: step.input
            ? String(this.state.inputs[step.input])
            : step.value,
        },
        ctx,
      );
    } catch (error) {
      // These errors occur before native input. Re-observe safely; never retry
      // a timeout or an action that may already have reached the website.
      if (
        error instanceof ToolError &&
        ["STALE_ELEMENT", "MOVING_ELEMENT"].includes(error.code)
      ) {
        this.uncertain = false;
        this.lastObservation = error;
        await abortable(
          new Promise((resolve) => setTimeout(resolve, 150)),
          signal,
        );
        return this.step(rawStep, signal);
      }
      if (
        error instanceof ToolError &&
        [
          "POLICY_DENIED",
          "RISKY_ACTION",
          "FOCUS_FAILED",
          "HIDDEN_ELEMENT",
          "DISABLED_ELEMENT",
          "READ_ONLY",
          "NOT_TEXT_INPUT",
          "NOT_SELECT",
          "SENSITIVE_ELEMENT",
          "SENSITIVE_PAGE",
          "OBSCURED_ELEMENT",
        ].includes(error.code)
      )
        this.uncertain = false;
      throw error;
    }
    if (step.operation === "fill")
      this.filled.set(fieldKey, String(this.state.inputs[step.input!]));
  }
  private async handleState(signal: AbortSignal): Promise<boolean> {
    if (!this.tabId) return false;
    const wc = this.context.browser.target(this.context.agentId, this.tabId);
    const matches: NonNullable<CapabilityDraft["handlers"]> = [];
    for (const handler of this.artifact.draft.handlers ?? []) {
      if (handler.before_step !== this.state.step) continue;
      try {
        const observation = await resolveTarget(wc, bindTarget(handler.when, this.state.inputs));
        if (observation.text.includes(bindText(handler.text, this.state.inputs))) matches.push(handler);
      } catch (error) {
        if (!(error instanceof ToolError) || !["TARGET_MISSING", "FRAME_MISSING", "PAGE_CHANGED"].includes(error.code)) throw error;
      }
    }
    if (!matches.length) return false;
    if (matches.length !== 1)
      throw new ToolError("AMBIGUOUS_OUTCOME", "Multiple declared states matched; human review is required.");
    const handler = matches[0];
    this.observedState = `Declared state ${handler.id}: ${handler.text}`;
    if (handler.disposition === "outcome") {
      this.state.result = { kind: "business_outcome", code: handler.id, message: handler.message, step: this.state.step };
      throw new BusinessOutcome();
    }
    if (handler.disposition === "failure") throw new ToolError(handler.id, handler.message);
    const count = this.recoveryCounts.get(handler.id) ?? 0;
    if (count >= handler.attempts)
      throw new ToolError("RECOVERY_EXHAUSTED", `Recovery ${handler.id} reached its attempt limit.`);
    this.recoveryCounts.set(handler.id, count + 1);
    if (handler.action !== "wait") {
      const target = await resolveTarget(wc, bindTarget(handler.target!, this.state.inputs));
      this.uncertain = true;
      await browserAction.execute({
        tab_id: this.tabId, frame_id: target.frame_id, snapshot_id: target.snapshot_id,
        ref: target.ref, action: handler.action, value: handler.key,
      }, { ...this.context, signal });
      this.uncertain = false;
    }
    await abortable(new Promise((resolve) => setTimeout(resolve, handler.wait_ms)), signal);
    return true;
  }
  private async saveValidation(success: boolean) {
    return serializeValidation(this.artifact.path, async () => {
      const prior = await validationState(
        this.artifact.path,
        this.artifact.hash,
      );
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
    });
  }
}
