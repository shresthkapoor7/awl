import { z } from "zod";
import { defineTool, ToolError } from "./core.cjs";
import { browserWait } from "./browser-wait.cjs";
export const taskComplete = defineTool(
  "task_complete",
  "Mark the browser task completed only after verifying an observed visible-text checkpoint on its current page. Ordinary responses and requests for help do not complete a task.",
  z.strictObject({
    tab_id: z.string().min(1).max(80),
    expected_text: z.string().min(1).max(250),
    summary: z.string().min(1).max(1000),
  }),
  async (args, context) => {
    if (!context.complete)
      throw new ToolError("UNAVAILABLE", "No active task.");
    await browserWait.execute(
      {
        tab_id: args.tab_id,
        condition: "text",
        contains: args.expected_text,
        timeout_ms: 5000,
      },
      context,
    );
    context.complete(args.summary);
    return { data: { completed: true, checkpoint: args.expected_text } };
  },
);
