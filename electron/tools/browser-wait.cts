import { z } from "zod";
import { setTimeout } from "node:timers/promises";
import { defineTool, tabIdSchema, ToolError } from "./core.cjs";
import { inPage, observable } from "./page.cjs";
export const browserWait = defineTool(
  "browser_wait",
  "Wait up to 10 seconds for visible text or a URL substring across the tab’s frames (text must match exactly one frame), or a URL substring in its main frame. Use after asynchronous page actions. Returns when the condition matches; a timeout does not imply an action failed. Do not retry a consequential action just because a wait timed out.",
  z.strictObject({
    tab_id: tabIdSchema,
    condition: z.enum(["text", "url"]),
    contains: z.string().min(1).max(250),
    timeout_ms: z.number().int().min(100).max(10000),
  }),
  async ({ tab_id, condition, contains, timeout_ms }, context) => {
    const wc = context.browser.target(context.agentId, tab_id);
    const deadline = Date.now() + timeout_ms;
    do {
      context.signal.throwIfAborted();
      const list = await observable(wc);
      const matches: string[] = [];
      for (const frame of condition === "url" ? list.slice(0, 1) : list) {
        const matched = await inPage(
          wc,
          frame.id,
          ({ condition, contains }) =>
            (condition === "url"
              ? location.href
              : document.body?.innerText || ""
            ).includes(contains),
          { condition, contains },
        );
        if (matched) matches.push(frame.id);
      }
      if (matches.length > 1)
        throw new ToolError(
          "AMBIGUOUS_CONDITION",
          "The checkpoint matches multiple frames. Use a more specific expected condition.",
        );
      if (matches.length === 1)
        return { data: { matched: true, tab_id, frame_id: matches[0] } };
      await setTimeout(
        Math.min(200, Math.max(1, deadline - Date.now())),
        undefined,
        { signal: context.signal },
      );
    } while (Date.now() < deadline);
    throw new ToolError(
      "CONDITION_TIMEOUT",
      "The condition did not appear in time. Inspect the current page before deciding what to do next.",
    );
  },
);
