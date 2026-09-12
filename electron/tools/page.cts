import type { WebContents } from "electron";
import { ToolError } from "./core.cjs";
export async function cdp(
  wc: WebContents,
  method: string,
  params: Record<string, unknown> = {},
) {
  if (wc.isDestroyed())
    throw new ToolError("TAB_NOT_FOUND", "The tab closed. List tabs again.");
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    return await wc.debugger.sendCommand(method, params);
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
        const fields = document.querySelectorAll(
          'input[type="password"],input[autocomplete="one-time-code"],input[autocomplete^="cc-"],input[autocomplete="current-password"],input[autocomplete="new-password"]',
        );
        return Array.from(fields).some(
          (el) =>
            el.getClientRects().length > 0 &&
            getComputedStyle(el).visibility !== "hidden",
        );
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
