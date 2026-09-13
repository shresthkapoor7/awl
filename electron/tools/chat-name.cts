import { z } from "zod";
import { defineTool, ToolError } from "./core.cjs";
export const chatName = defineTool(
  "chat_set_name",
  "Give the current chat a short descriptive task name. Only changes this chat; do not include credentials or personal identifiers.",
  z.strictObject({ name: z.string().min(1).max(60) }),
  async ({ name }, context) => {
    const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
    if (!clean)
      throw new ToolError(
        "INVALID_ARGUMENTS",
        "The chat name must contain visible text.",
      );
    context.rename(clean);
    return { data: { name: clean } };
  },
);
