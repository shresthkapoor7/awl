import { z } from "zod";
export const targetSchema = z.strictObject({
  kind: z.enum(["css", "role", "label", "placeholder", "text"]),
  value: z.string().min(1).max(500),
  role: z.string().min(1).max(80).nullable(),
  frame: z
    .strictObject({ url: z.string().max(2000), name: z.string().max(200) })
    .nullable(),
  shadow: z.array(z.string().min(1).max(500)).max(8),
  within: z.string().min(1).max(500).nullable(),
});
export type Target = z.infer<typeof targetSchema>;
