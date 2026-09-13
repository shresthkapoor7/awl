import { z } from "zod";

export const policyActions = [
  "navigate",
  "click",
  "fill",
  "select",
  "press",
  "scroll",
] as const;
const action = z.enum(policyActions);
const origin = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }, "Use an exact website origin, such as https://example.com (no trailing slash).");
const path = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !/[?#\\\s]/.test(value) &&
      (!value.includes("*") ||
        (value.endsWith("/*") && !value.slice(0, -1).includes("*"))),
    "Use a path such as /search or /work/*, without a query or fragment.",
  );
const selector = z.string().trim().min(1).max(500);
export const policySchema = z.strictObject({
  destinations: z
    .array(z.strictObject({ origin, paths: z.array(path).min(1).max(100) }))
    .max(100),
  actions: z.array(action).max(6),
  safeControls: z
    .array(
      z.strictObject({
        origin,
        path,
        selector,
        actions: z.array(action).min(1).max(6),
      }),
    )
    .max(200),
  sensitiveSelectors: z.array(selector).max(200).default([]),
  blockedControls: z.array(selector).max(200),
});
export type PolicyConfig = z.infer<typeof policySchema>;
export type PolicyState = {
  config: PolicyConfig;
  revision: string;
  external: boolean;
};
export type PolicyResult = { state?: PolicyState; error?: string };
