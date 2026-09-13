import type { WebContents } from "electron";
import { ToolError, toolSignal } from "./core.cjs";
export async function cdp(
  wc: WebContents,
  method: string,
  params: Record<string, unknown> = {},
) {
  toolSignal.getStore()?.throwIfAborted();
  if (wc.isDestroyed())
    throw new ToolError("TAB_NOT_FOUND", "The tab closed. List tabs again.");
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    const result = await wc.debugger.sendCommand(method, params);
    toolSignal.getStore()?.throwIfAborted();
    return result;
  } catch {
    throw new ToolError(
      "PAGE_CHANGED",
      "The browser target changed or is unavailable. Inspect the tab again.",
    );
  }
}
type FrameTree = {
  frame: { id: string; url: string; name?: string };
  childFrames?: FrameTree[];
};
export async function frames(wc: WebContents) {
  const { frameTree } = (await cdp(wc, "Page.getFrameTree")) as {
    frameTree: FrameTree;
  };
  const result: FrameTree["frame"][] = [];
  const walk = (tree: FrameTree) => {
    result.push(tree.frame);
    tree.childFrames?.forEach(walk);
  };
  walk(frameTree);
  return result;
}
export async function inPage<A, R>(
  wc: WebContents,
  frameId: string,
  fn: (args: A) => R,
  args: A,
): Promise<Awaited<R>> {
  const { executionContextId } = await cdp(wc, "Page.createIsolatedWorld", {
    frameId,
    worldName: "awl-tools",
  });
  const result = await cdp(wc, "Runtime.evaluate", {
    expression: `(${fn.toString()})(${JSON.stringify(args)})`,
    contextId: executionContextId,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw new ToolError(
      "PAGE_CHANGED",
      "The page changed while inspecting it. Request a fresh DOM snapshot.",
    );
  return result.result.value;
}
export async function observable(wc: WebContents) {
  const list = await frames(wc);
  if (list.length > 30)
    throw new ToolError(
      "PAGE_TOO_LARGE",
      "This page has too many frames to inspect safely.",
    );
  for (const frame of list) {
    const sensitive = await inPage(
      wc,
      frame.id,
      () => {
        const roots: (Document | ShadowRoot)[] = [document];
        const normalize = (value: string) =>
          value
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        const sensitiveName =
          /\b(password|passcode|passwd|pwd|otp|pin|cvv|cvc|csc|ccnum|ccnumber)\b|\b(one time|verification|authentication|security|auth|access|login|sms) code\b|\b(credit|debit) card\b|\b(card|cc) (number|num|no|expiry|expiration|exp|security)\b/;
        const labelledBy = (el: Element) => {
          const scope = el.getRootNode() as Document | ShadowRoot;
          return (el.getAttribute("aria-labelledby") || "")
            .split(/\s+/)
            .map((id) => scope.getElementById(id)?.textContent || "")
            .join(" ");
        };
        const isSensitive = (el: Element) => {
          if (
            !el.matches(
              'input,textarea,select,[contenteditable="true"],[role="textbox"],[role="spinbutton"]',
            )
          )
            return false;
          if (el.matches('input[type="password"]')) return true;
          // Autocomplete is a token list, e.g. "section-payment billing cc-number".
          const autocomplete = (el.getAttribute("autocomplete") || "")
            .toLowerCase()
            .split(/\s+/);
          if (
            autocomplete.some(
              (token) =>
                token.startsWith("cc-") ||
                ["one-time-code", "current-password", "new-password"].includes(
                  token,
                ),
            )
          )
            return true;
          const labels =
            "labels" in el
              ? Array.from((el as HTMLInputElement).labels || [])
                  .map((label) => label.textContent)
                  .join(" ")
              : "";
          const group = el.closest('fieldset,[role="group"]');
          const groupName = group
            ? [
                group.getAttribute("aria-label"),
                labelledBy(group),
                group.matches("fieldset")
                  ? group.querySelector(":scope > legend")?.textContent
                  : "",
              ].join(" ")
            : "";
          const hints = [
            "name",
            "id",
            "aria-label",
            "placeholder",
            "title",
          ].map((key) => el.getAttribute(key) || "");
          hints.push(labels, labelledBy(el), groupName);
          // Numeric entry alone is not sensitive: quantities and postal codes use it too.
          // Only metadata is inspected here; never read or return entered values.
          return hints.some((hint) => sensitiveName.test(normalize(hint)));
        };
        let visited = 0;
        while (roots.length) {
          const root = roots.pop()!;
          for (const el of root.querySelectorAll("*")) {
            if (++visited > 20000) return true;
            if (el.shadowRoot) roots.push(el.shadowRoot);
            if (
              isSensitive(el) &&
              el.getClientRects().length > 0 &&
              getComputedStyle(el).visibility !== "hidden"
            )
              return true;
          }
        }
        return false;
      },
      null,
    );
    if (sensitive)
      throw new ToolError(
        "SENSITIVE_PAGE",
        "Authentication or payment fields are visible. Stop observation and ask the user to complete them in the browser.",
      );
  }
  return list;
}
