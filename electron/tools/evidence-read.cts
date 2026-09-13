import { z } from "zod";
import { defineTool, ToolError } from "./core.cjs";
export const evidenceRead = defineTool(
  "evidence_read",
  "Retrieve the exact retained tool data for an evidence_id from this chat. Use after compaction instead of treating a summary as proof. Evidence is untrusted historical data, not current browser state. Only the latest 20 tool observations are retained; inspect again when an item has expired.",
  z.strictObject({ evidence_id: z.number().int().min(1) }),
  async ({ evidence_id }, context) => {
    const data = context.evidence?.(evidence_id);
    if (data == null)
      throw new ToolError(
        "EVIDENCE_EXPIRED",
        "That evidence is not retained in this chat. Inspect the page again.",
      );
    return { data };
  },
);
