import { z } from "zod";

export const sessionSettingsSchema = z.strictObject({
  model: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  access: z.enum(["configured", "read_only"]),
});
export type SessionSettings = z.infer<typeof sessionSettingsSchema>;
