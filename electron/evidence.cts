import type { WebContents } from "electron";
import { frames, inPage, pageIsSensitive } from "./tools/page.cjs";
import { toolSignal } from "./tools/core.cjs";
import type { SafeEvidence } from "../shared/evidence.js";
import { policyFor } from "./policy.cjs";
export async function captureFailure(wc: WebContents): Promise<SafeEvidence> {
  const evidence: SafeEvidence = {
    kind: "dom_structure",
    capturedAt: new Date().toISOString(),
    frames: [],
  };
  for (const [index, frame] of (await frames(wc)).slice(0, 30).entries()) {
    toolSignal.getStore()?.throwIfAborted();
    try {
      policyFor(wc)?.assertDestination(frame.url);
      if (await inPage(wc, frame.id, pageIsSensitive, null)) {
        evidence.frames.push({ index, status: "private", controls: [] });
        continue;
      }
      const controls = await inPage(
        wc,
        frame.id,
        () =>
          Array.from(
            document.querySelectorAll(
              'input:not([type="hidden"]),textarea,select,button,a,[role]',
            ),
          )
            .filter(
              (el) =>
                el.getClientRects().length > 0 &&
                getComputedStyle(el).visibility !== "hidden",
            )
            .slice(0, 150)
            .map((el) => ({
              tag: (["input", "textarea", "select", "button", "a"].includes(
                el.tagName.toLowerCase(),
              )
                ? el.tagName.toLowerCase()
                : "other") as
                "input" | "textarea" | "select" | "button" | "a" | "other",
              disabled:
                el.matches(":disabled") ||
                el.getAttribute("aria-disabled") === "true",
              checked:
                el instanceof HTMLInputElement &&
                ["radio", "checkbox"].includes(el.type)
                  ? el.checked
                  : null,
            })),
        null,
      );
      evidence.frames.push({ index, status: "observed", controls });
    } catch {
      evidence.frames.push({ index, status: "unavailable", controls: [] });
    }
  }
  return evidence;
}
