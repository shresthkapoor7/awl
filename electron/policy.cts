import { policySchema, type PolicyConfig } from "../shared/policy.js";
export { policySchema, type PolicyConfig } from "../shared/policy.js";
import { readFileSync } from "node:fs";
import type { WebContents } from "electron";
import { ToolError } from "./tools/core.cjs";
export type ActionFacts = {
  url: string;
  tag: string;
  type: string;
  text: string;
  href: string | null;
  allowed: boolean;
  blocked: boolean;
};
function pathMatches(path: string, rule: string) {
  return rule.endsWith("/*")
    ? path === rule.slice(0, -2) || path.startsWith(rule.slice(0, -1))
    : path === rule;
}
export class BrowserPolicy {
  readonly config: PolicyConfig;
  constructor(raw: unknown) {
    this.config = policySchema.parse(raw);
    for (const item of [
      ...this.config.destinations,
      ...this.config.safeControls,
    ])
      if (
        new URL(item.origin).origin !== item.origin ||
        !/^https?:/.test(item.origin)
      )
        throw new Error("Policy destinations must be exact HTTP(S) origins.");
  }
  destination(url: string): boolean {
    if (url === "about:blank") return true;
    try {
      const parsed = new URL(url);
      return (
        !parsed.username &&
        !parsed.password &&
        this.config.destinations.some(
          (rule) =>
            parsed.origin === rule.origin &&
            rule.paths.some((path) => pathMatches(parsed.pathname, path)),
        )
      );
    } catch {
      return false;
    }
  }
  assertDestination(url: string) {
    if (!this.destination(url))
      throw new ToolError(
        "POLICY_DENIED",
        "This destination is outside the configured browser policy. Open Manage access in the composer to change the allowed websites.",
      );
  }
  assertType(action: string) {
    if (!this.config.actions.some((allowed) => allowed === action))
      throw new ToolError(
        "POLICY_DENIED",
        "This action type is not permitted by the browser policy.",
      );
  }
  controls(url: string, action: string) {
    const parsed = new URL(url);
    return this.config.safeControls
      .filter(
        (rule) =>
          rule.origin === parsed.origin &&
          pathMatches(parsed.pathname, rule.path) &&
          rule.actions.some((item) => item === action),
      )
      .map((rule) => rule.selector);
  }
  assertAction(action: string, value: string | null, facts: ActionFacts) {
    this.assertDestination(facts.url);
    this.assertType(action);
    const activating =
      action === "click" || (action === "press" && value === "Enter");
    if (
      facts.blocked ||
      (activating &&
        /\b(post|transfer|purchase|pay|delete|erase|authorize|approve|send payment)\b/i.test(
          facts.text,
        ))
    )
      throw new ToolError(
        "RISKY_ACTION",
        "This control requires direct human operation. Take over, verify the specific request, then resume after completing it.",
      );
    if (!activating) return;
    if (facts.href) {
      this.assertDestination(facts.href);
      return;
    }
    if (["radio", "checkbox"].includes(facts.type) && !facts.blocked) return;
    if (!facts.allowed)
      throw new ToolError(
        "RISKY_ACTION",
        "This activating control is not declared safe in the browser policy. A human must operate it or configure its reviewed scope.",
      );
  }
}
// A per-chat restriction can narrow the configured policy, never broaden it.
export function readOnlyPolicy(policy: BrowserPolicy) {
  return new BrowserPolicy({
    ...policy.config,
    actions: policy.config.actions.filter(
      (action) => action === "navigate" || action === "scroll",
    ),
    safeControls: [],
  });
}
const attached = new WeakMap<WebContents, BrowserPolicy>();
export function attachPolicy(wc: WebContents, policy: BrowserPolicy) {
  attached.set(wc, policy);
}
export function policyFor(wc: WebContents) {
  return attached.get(wc);
}
export function loadPolicy(file?: string) {
  return new BrowserPolicy(
    file
      ? JSON.parse(readFileSync(file, "utf8"))
      : {
          destinations: [],
          actions: ["navigate", "click", "fill", "select", "press", "scroll"],
          safeControls: [],
          blockedControls: [],
        },
  );
}
