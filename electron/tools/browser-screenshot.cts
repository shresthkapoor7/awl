import { z } from "zod";
import { privatePageValues } from "../privacy.cjs";
import { policyFor } from "../policy.cjs";
import { defineTool, tabIdSchema, ToolError } from "./core.cjs";
import { cdp, observable, inPage } from "./page.cjs";
export const browserScreenshot = defineTool(
  "browser_screenshot",
  "Capture the current tab viewport as an image. Returns CSS viewport size and image size; the image is scaled to at most 1280 pixels wide. Not a full-page image. Sensitive authentication/payment pages cannot be captured. A bounded copy can be retained in this chat’s local run history while observation is allowed.",
  z.strictObject({ tab_id: tabIdSchema }),
  async ({ tab_id }, context) => {
    const wc = context.browser.target(context.agentId, tab_id);
    for (const frame of await observable(wc))
      if (
        (
          await inPage(
            wc,
            frame.id,
            privatePageValues,
            policyFor(wc)?.config.sensitiveSelectors ?? [],
          )
        ).length
      )
        throw new ToolError(
          "PRIVATE_SCREENSHOT",
          "Personal data is visible. Use redacted DOM inspection instead of a screenshot.",
        );
    context.signal.throwIfAborted();
    const { cssVisualViewport: viewport } = await cdp(
      wc,
      "Page.getLayoutMetrics",
    );
    const scale = Math.min(
      1,
      1280 / viewport.clientWidth,
      1280 / viewport.clientHeight,
    );
    const { data } = await cdp(wc, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: {
        x: viewport.pageX,
        y: viewport.pageY,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
        scale,
      },
    });
    for (const frame of await observable(wc))
      if (
        (
          await inPage(
            wc,
            frame.id,
            privatePageValues,
            policyFor(wc)?.config.sensitiveSelectors ?? [],
          )
        ).length
      )
        throw new ToolError(
          "PRIVATE_SCREENSHOT",
          "Personal data is visible. Use redacted DOM inspection instead of a screenshot.",
        );
    if (typeof data !== "string" || data.length > 7_000_000)
      throw new ToolError(
        "CAPTURE_FAILED",
        "The browser screenshot was empty or too large.",
      );
    return {
      data: {
        tab_id,
        viewport: {
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        },
        image: {
          width: Math.round(viewport.clientWidth * scale),
          height: Math.round(viewport.clientHeight * scale),
        },
      },
      image: `data:image/png;base64,${data}`,
    };
  },
);
