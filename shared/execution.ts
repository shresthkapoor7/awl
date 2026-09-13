import { z } from "zod";
export const executionResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("success"),
    outputs: z.record(z.string(), z.string()),
  }),
  z.object({
    kind: z.literal("business_outcome"),
    code: z.string(),
    message: z.string(),
    step: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("failure"),
    code: z.string(),
    message: z.string(),
    step: z.number().int().nonnegative(),
    expected: z.string(),
    observed: z.string(),
    uncertain: z.boolean(),
  }),
]);
export type ExecutionResult = z.infer<typeof executionResultSchema>;
