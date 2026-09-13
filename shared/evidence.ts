import { z } from "zod";
export const safeEvidenceSchema = z.object({
  kind: z.literal("dom_structure"),
  capturedAt: z.string(),
  frames: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        status: z.enum(["observed", "private", "unavailable"]),
        controls: z
          .array(
            z.object({
              tag: z.enum([
                "input",
                "textarea",
                "select",
                "button",
                "a",
                "other",
              ]),
              disabled: z.boolean(),
              checked: z.boolean().nullable(),
            }),
          )
          .max(150),
      }),
    )
    .max(30),
});
export type SafeEvidence = z.infer<typeof safeEvidenceSchema>;
