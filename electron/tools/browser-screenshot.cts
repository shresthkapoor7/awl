import { z } from "zod";
import { defineTool, tabIdSchema, ToolError } from "./core.cjs";
import { cdp, observable } from "./page.cjs";
export const browserScreenshot = defineTool(
  "browser_screenshot",
  "Capture the current tab viewport as an image. Returns CSS viewport size and image size; the image is scaled to at most 1280 pixels wide. Not a full-page image. Sensitive authentication/payment pages cannot be captured. A bounded copy can be retained in this chat’s local run history while observation is allowed.",
  z.strictObject({ tab_id: tabIdSchema }),
  async ({ tab_id }, context) => {
    const wc = context.browser.target(context.agentId, tab_id);
    await observable(wc);
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
    await observable(wc);
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
