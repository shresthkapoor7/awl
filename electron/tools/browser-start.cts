import { observedBrowserState } from "./observation-url.cjs";
import { z } from "zod";
import { defineTool, tabIdSchema } from "./core.cjs";
export const browserStart = defineTool(
  "browser_start",
  "Open a website in this chat’s local browser. Pass null for tab_id to reuse a blank tab or open a new one; pass an existing tab ID to navigate it. Returns tab IDs and final URL origins/paths after loading; query strings and fragments are omitted. Never navigate away from a form you need to preserve.",
  z.strictObject({
    url: z.string().min(1).max(8192),
    tab_id: tabIdSchema.nullable(),
  }),
  async ({ url, tab_id }, context) => ({
    data: observedBrowserState(
      await context.browser.start(context.agentId, url, tab_id, context.signal),
    ),
  }),
);
