import { z } from "zod";
import { defineTool, ToolError } from "./core.cjs";
export const askUser = defineTool(
  "ask_user",
  "Pause this task and ask the human for clarification, authentication, a demonstration, or help with an unexpected state. No browser work continues until explicit Resume. Never ask for passwords or codes in chat. expected_text is a visible continuation checkpoint, or null when the human answer itself is sufficient.",
  z.strictObject({
    reason: z.enum([
      "authentication",
      "clarification",
      "demonstration",
      "unexpected_state",
    ]),
    question: z.string().min(1).max(1000),
    choices: z.array(z.string().min(1).max(160)).max(5),
    expected_text: z.string().min(1).max(250).nullable(),
  }),
  async (args, context) => {
    if (!context.ask)
      throw new ToolError("UNAVAILABLE", "Questions require an active task.");
    return { data: context.ask(args) };
  },
);
