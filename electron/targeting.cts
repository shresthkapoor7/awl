import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type { Target } from "../shared/target.js";
import { ToolError } from "./tools/core.cjs";
import { cdp, frames, inPage, observable } from "./tools/page.cjs";
import { registerSnapshot, type PageSnapshot } from "./tools/snapshots.cjs";

// Self-contained: installed only in awl's isolated world; never accepts source from the model.
export function targetingRuntime() {
  const text = (value: string | null | undefined) =>
    (value || "").replace(/\s+/g, " ").trim();
  const visible = (el: Element) =>
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const role = (el: Element): string => {
    if (el.getAttribute("role")) return el.getAttribute("role")!;
    if (
      el.matches(
        'button,input[type="button"],input[type="submit"],input[type="reset"]',
      )
    )
      return "button";
    if (el.matches("a[href]")) return "link";
    if (el.matches('input[type="checkbox"]')) return "checkbox";
    if (el.matches('input[type="radio"]')) return "radio";
    if (el.matches('input[type="range"]')) return "slider";
    if (el.matches('input[type="number"]')) return "spinbutton";
    if (el.matches("select"))
      return (el as HTMLSelectElement).multiple ? "listbox" : "combobox";
    if (
      el.matches(
        'textarea,input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="url"],input[type="password"]',
      )
    )
      return "textbox";
    if (el.matches('input[type="search"]')) return "searchbox";
    if (el.matches("h1,h2,h3,h4,h5,h6")) return "heading";
    return "";
  };
  const label = (el: Element): string => {
    const root = el.getRootNode() as Document | ShadowRoot;
    const ids = el.getAttribute("aria-labelledby");
    if (ids)
      return text(
        ids
          .split(/\s+/)
          .map((id) => root.getElementById(id)?.textContent)
          .join(" "),
      );
    if (el.hasAttribute("aria-label"))
      return text(el.getAttribute("aria-label"));
    if ("labels" in el) {
      const labels = text(
        Array.from((el as HTMLInputElement).labels || [])
          .map((item) => item.textContent)
          .join(" "),
      );
      if (labels) return labels;
    }
    if (
      el.matches(
        'input[type="submit"],input[type="button"],input[type="reset"]',
      )
    )
      return (el as HTMLInputElement).value;
    if (["button", "link", "heading"].includes(role(el)))
      return text((el as HTMLElement).innerText || el.textContent);
    return text(el.getAttribute("title"));
  };
  const css = (el: Element): string | null => {
    const root = el.getRootNode() as Document | ShadowRoot;
    const candidates: string[] = [];
    if (el.id) candidates.push(`#${CSS.escape(el.id)}`);
    for (const key of ["data-testid", "data-test", "name"]) {
      const value = el.getAttribute(key);
      if (value)
        candidates.push(
          `${el.tagName.toLowerCase()}[${key}=${JSON.stringify(value)}]`,
        );
    }
    return (
      candidates.find(
        (candidate) => root.querySelectorAll(candidate).length === 1,
      ) ?? null
    );
  };
  const resolve = (target: Target): Element[] => {
    let root: Document | ShadowRoot | Element = document;
    for (const selector of target.shadow) {
      const hosts: NodeListOf<Element> = root.querySelectorAll(selector);
      if (hosts.length !== 1 || !hosts[0].shadowRoot) return [];
      root = hosts[0].shadowRoot;
    }
    if (target.within) {
      const containers = root.querySelectorAll(target.within);
      if (containers.length !== 1) return [];
      root = containers[0];
    }
    const all = Array.from(
      root.querySelectorAll(target.kind === "css" ? target.value : "*"),
    ).filter(visible);
    if (target.kind === "css") return all;
    return all.filter((el) => {
      if (target.kind === "role")
        return role(el) === target.role && label(el) === target.value;
      if (target.kind === "label")
        return (
          el.matches("input,textarea,select,[role='textbox']") &&
          label(el) === target.value
        );
      if (target.kind === "placeholder")
        return el.getAttribute("placeholder") === target.value;
      return (
        text((el as HTMLElement).innerText || el.textContent) ===
          target.value &&
        !Array.from(el.children).some(
          (child) =>
            text((child as HTMLElement).innerText || child.textContent) ===
            target.value,
        )
      );
    });
  };
  const describe = (el: Element): Target | null => {
    const shadow: string[] = [];
    let root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      const host = css(root.host);
      if (!host || shadow.length >= 8) return null;
      shadow.unshift(host);
      root = root.host.getRootNode();
    }
    const base = { frame: null, shadow, within: null, role: null };
    const candidates: Target[] = [];
    const selector = css(el);
    if (selector) candidates.push({ ...base, kind: "css", value: selector });
    const name = label(el);
    if (role(el) && name && name.length <= 500)
      candidates.push({ ...base, kind: "role", role: role(el), value: name });
    if (name && name.length <= 500 && el.matches("input,textarea,select"))
      candidates.push({ ...base, kind: "label", value: name });
    const placeholder = el.getAttribute("placeholder");
    if (placeholder && placeholder.length <= 500)
      candidates.push({ ...base, kind: "placeholder", value: placeholder });
    const content = text((el as HTMLElement).innerText || el.textContent);
    if (content && content.length <= 200)
      candidates.push({ ...base, kind: "text", value: content });
    return (
      candidates.find((candidate) => {
        const matches = resolve(candidate);
        return matches.length === 1 && matches[0] === el;
      }) ?? null
    );
  };
  return { describe, resolve, role, label };
}
export type TargetingRuntime = ReturnType<typeof targetingRuntime>;
export async function installTargeting(wc: WebContents, frameId: string) {
  const { executionContextId } = await cdp(wc, "Page.createIsolatedWorld", {
    frameId,
    worldName: "awl-tools",
  });
  await cdp(wc, "Runtime.evaluate", {
    contextId: executionContextId,
    expression: `globalThis.__awlTargeting = (${targetingRuntime.toString()})();`,
  });
}
export function frameIdentity(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}
export async function targetFrame(wc: WebContents, target: Target) {
  const list = await frames(wc);
  if (!target.frame) return list[0].id;
  const found = list.filter(
    (frame) =>
      frameIdentity(frame.url) === target.frame!.url &&
      (frame.name || "") === target.frame!.name,
  );
  if (found.length !== 1)
    throw new ToolError(
      "AMBIGUOUS_FRAME",
      "The recorded frame is missing or ambiguous.",
    );
  return found[0].id;
}
export async function resolveTarget(wc: WebContents, target: Target) {
  await observable(wc);
  const frameId = await targetFrame(wc, target);
  await installTargeting(wc, frameId);
  const snapshotId = randomUUID();
  const result = await inPage(
    wc,
    frameId,
    ({ target, snapshotId }) => {
      const holder = globalThis as typeof globalThis & {
        __awlTargeting: TargetingRuntime;
        __awlSnapshot?: PageSnapshot;
      };
      const matches = holder.__awlTargeting.resolve(target);
      if (matches.length !== 1) return { count: matches.length, text: "" };
      const element = matches[0];
      const signature = (el: Element) =>
        [
          el.tagName,
          el.getAttribute("type"),
          holder.__awlTargeting.role(el),
          holder.__awlTargeting.label(el),
        ].join("|");
      holder.__awlSnapshot = {
        id: snapshotId,
        url: location.href,
        signature,
        nodes: new Map([["e0", { element, signature: signature(element) }]]),
      };
      return {
        count: 1,
        text: (
          (element as HTMLElement).innerText ||
          element.textContent ||
          ""
        ).slice(0, 12000),
      };
    },
    { target, snapshotId },
  );
  if (result.count !== 1)
    throw new ToolError(
      result.count ? "AMBIGUOUS_TARGET" : "TARGET_MISSING",
      "The target must match exactly one visible element.",
    );
  registerSnapshot(wc, frameId, snapshotId);
  return {
    frame_id: frameId,
    snapshot_id: snapshotId,
    ref: "e0",
    text: result.text,
  };
}
