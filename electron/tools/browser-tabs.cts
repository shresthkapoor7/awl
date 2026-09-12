import { z } from "zod";
import { defineTool, tabIdSchema } from "./core.cjs";
export const browserTabs = defineTool(
  "browser_tabs",
  "List, select, or close tabs belonging to the current chat. Use list after popups or navigation errors. tab_id must be null for list, or the returned ID for select/close. Closing a tab loses its unsaved form state.",
  z.strictObject({
    action: z.enum(["list", "select", "close"]),
    tab_id: tabIdSchema.nullable(),
  }),
  async ({ action, tab_id }, context) => ({
    data: context.browser.tabs(context.agentId, action, tab_id),
  }),
);
