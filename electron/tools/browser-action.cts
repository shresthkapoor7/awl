import { z } from "zod";
import { defineTool, tabIdSchema, ToolError } from "./core.cjs";
import { cdp, inPage, observable } from "./page.cjs";
import { consumeSnapshot, type PageSnapshot } from "./browser-dom.cjs";
const keys: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  ArrowDown: 40,
  ArrowUp: 38,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
};
export const browserAction = defineTool(
  "browser_action",
  "Act on an exact element ref from browser_dom: click, fill, select, press, or scroll. snapshot_id/frame_id must match that snapshot. value is text for fill, option value for select, key name for press, 'up'/'down' for scroll, or null for click. Each action consumes the snapshot. Clicks and typing use browser input events. Results acknowledge dispatch, not task success: inspect again to verify. Do not enter credentials or execute irreversible actions outside the user’s goal.",
  z.strictObject({
    tab_id: tabIdSchema,
    frame_id: z.string().min(1).max(100),
    snapshot_id: z.string().uuid(),
    ref: z.string().regex(/^e\d+$/),
    action: z.enum(["click", "fill", "select", "press", "scroll"]),
    value: z.string().max(4000).nullable(),
  }),
  async (args, context) => {
    const wc = context.browser.target(context.agentId, args.tab_id);
    await observable(wc);
    if (
      args.action === "press" &&
      (!args.value || !Object.hasOwn(keys, args.value))
    )
      throw new ToolError(
        "INVALID_ARGUMENTS",
        `Supported keys: ${Object.keys(keys).join(", ")}.`,
      );
    if (args.action === "scroll" && !["up", "down"].includes(args.value ?? ""))
      throw new ToolError(
        "INVALID_ARGUMENTS",
        "Scroll value must be up or down.",
      );
    if (["fill", "select"].includes(args.action) && args.value === null)
      throw new ToolError("INVALID_ARGUMENTS", "This action requires a value.");
    consumeSnapshot(wc, args.frame_id, args.snapshot_id);
    const prepared = await inPage(
      wc,
      args.frame_id,
      async (args) => {
        const holder = globalThis as typeof globalThis & {
          __awlSnapshot?: PageSnapshot;
        };
        const snapshot = holder.__awlSnapshot;
        const entry = snapshot?.nodes.get(args.ref);
        if (
          !snapshot ||
          snapshot.id !== args.snapshot_id ||
          snapshot.url !== location.href ||
          !entry ||
          !entry.element.isConnected ||
          entry.signature !== snapshot.signature(entry.element)
        )
          return { error: "STALE_ELEMENT" };
        const el = entry.element as HTMLElement;
        if (
          el.matches(":disabled") ||
          el.getAttribute("aria-disabled") === "true"
        )
          return { error: "DISABLED_ELEMENT" };
        if (
          el.matches(
            'input[type="password"],input[type="file"],input[autocomplete="one-time-code"],input[autocomplete^="cc-"]',
          )
        )
          return { error: "SENSITIVE_ELEMENT" };
        el.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "instant",
        });
        const rect = el.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          getComputedStyle(el).visibility === "hidden"
        )
          return { error: "HIDDEN_ELEMENT" };
        const root = el.getRootNode() as Document | ShadowRoot;
        const hit = root.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        if (args.action === "click" && hit !== el && !el.contains(hit))
          return { error: "OBSCURED_ELEMENT" };
        if (args.action === "fill") {
          if (
            !(el instanceof HTMLTextAreaElement) &&
            !(
              el instanceof HTMLInputElement &&
              ["text", "email", "search", "url", "tel", "number"].includes(
                el.type,
              )
            )
          )
            return { error: "NOT_TEXT_INPUT" };
          if ((el as HTMLInputElement).readOnly) return { error: "READ_ONLY" };
        }
        if (args.action === "select" && !(el instanceof HTMLSelectElement))
          return { error: "NOT_SELECT" };
        el.focus();
        if (!el.isConnected) return { error: "STALE_ELEMENT" };
        if (
          ["fill", "press"].includes(args.action) &&
          root.activeElement !== el
        )
          return { error: "FOCUS_FAILED" };
        if (args.action === "fill")
          (el as HTMLInputElement | HTMLTextAreaElement).select();
        if (!el.isConnected) return { error: "STALE_ELEMENT" };
        if (args.action === "click") {
          // Layout can be ready before Chromium has submitted its hit-test regions.
          // Wait for stable painted frames before dispatching a single native click.
          const before = el.getBoundingClientRect();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const after = el.getBoundingClientRect();
          if (
            !el.isConnected ||
            Math.abs(before.x - after.x) > 0.5 ||
            Math.abs(before.y - after.y) > 0.5 ||
            Math.abs(before.width - after.width) > 0.5 ||
            Math.abs(before.height - after.height) > 0.5
          )
            return { error: "MOVING_ELEMENT" };
          const root = el.getRootNode() as Document | ShadowRoot;
          const hit = root.elementFromPoint(
            after.x + after.width / 2,
            after.y + after.height / 2,
          );
          if (!hit || (hit !== el && !el.contains(hit)))
            return { error: "OBSCURED_ELEMENT" };
        }
        return {
          error: null,
          nativeSelect: el instanceof HTMLInputElement && el.type === "number",
        };
      },
      args,
    );
    if (prepared.error)
      throw new ToolError(
        prepared.error,
        "The element cannot be used. Take a fresh DOM snapshot and check its state.",
      );
    context.signal.throwIfAborted();
    try {
      if (args.action === "click") {
        const { executionContextId } = await cdp(
          wc,
          "Page.createIsolatedWorld",
          { frameId: args.frame_id, worldName: "awl-tools" },
        );
        const remote = await cdp(wc, "Runtime.evaluate", {
          contextId: executionContextId,
          expression: `globalThis.__awlSnapshot.nodes.get(${JSON.stringify(args.ref)}).element`,
          objectGroup: "awl-action",
        });
        try {
          const { quads } = await cdp(wc, "DOM.getContentQuads", {
            objectId: remote.result.objectId,
          });
          const quad = quads?.[0];
          if (!quad)
            throw new ToolError(
              "HIDDEN_ELEMENT",
              "The element has no clickable area.",
            );
          const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
          const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
          try {
            await cdp(wc, "Input.dispatchMouseEvent", {
              type: "mousePressed",
              x,
              y,
              button: "left",
              clickCount: 1,
            });
          } finally {
            await wc.debugger
              .sendCommand("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x,
                y,
                button: "left",
                clickCount: 1,
              })
              .catch(() => {});
          }
        } finally {
          await cdp(wc, "Runtime.releaseObjectGroup", {
            objectGroup: "awl-action",
          }).catch(() => {});
        }
      } else if (args.action === "fill") {
        const key = async (
          down: Record<string, unknown>,
          up: Record<string, unknown>,
        ) => {
          try {
            await cdp(wc, "Input.dispatchKeyEvent", {
              type: "keyDown",
              ...down,
            });
          } finally {
            await wc.debugger
              .sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...up })
              .catch(() => {});
          }
        };
        // Number inputs do not expose DOM text selection APIs.
        if (prepared.nativeSelect) {
          const select = {
            key: "a",
            code: "KeyA",
            modifiers: process.platform === "darwin" ? 4 : 2,
          };
          await key({ ...select, commands: ["selectAll"] }, select);
        }
        if (args.value === "")
          await key(
            { key: "Backspace", windowsVirtualKeyCode: 8 },
            { key: "Backspace", windowsVirtualKeyCode: 8 },
          );
        else await cdp(wc, "Input.insertText", { text: args.value });
        const retained = await inPage(
          wc,
          args.frame_id,
          (args) => {
            const holder = globalThis as typeof globalThis & {
              __awlSnapshot?: PageSnapshot;
            };
            const entry = holder.__awlSnapshot?.nodes.get(args.ref);
            return (
              !!entry?.element.isConnected &&
              (entry.element as HTMLInputElement | HTMLTextAreaElement)
                .value === args.value
            );
          },
          args,
        );
        if (!retained)
          throw new ToolError(
            "FIELD_VALUE_CHANGED",
            "The field did not retain the entered text. The page may have replaced, cleared, or rejected it. Inspect the field before continuing.",
          );
      } else if (args.action === "press") {
        const key = {
          key: args.value,
          windowsVirtualKeyCode: keys[args.value!],
        };
        try {
          await cdp(wc, "Input.dispatchKeyEvent", {
            type: "keyDown",
            ...key,
            ...(args.value === "Enter" ? { text: "\r" } : {}),
          });
        } finally {
          await wc.debugger
            .sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...key })
            .catch(() => {});
        }
      } else {
        const result = await inPage(
          wc,
          args.frame_id,
          (args) => {
            const holder = globalThis as typeof globalThis & {
              __awlSnapshot?: PageSnapshot;
            };
            const el = holder.__awlSnapshot?.nodes.get(args.ref)?.element;
            if (!el?.isConnected) return false;
            if (args.action === "select") {
              const select = el as HTMLSelectElement;
              const option = Array.from(select.options).find(
                (item) => item.value === args.value && !item.disabled,
              );
              if (!option) return false;
              select.value = option.value;
              select.dispatchEvent(new Event("input", { bubbles: true }));
              select.dispatchEvent(new Event("change", { bubbles: true }));
            } else
              (el === document.body
                ? (document.scrollingElement ?? el)
                : el
              ).scrollBy({
                top: args.value === "down" ? 600 : -600,
                behavior: "instant",
              });
            return true;
          },
          args,
        );
        if (!result)
          throw new ToolError(
            "ACTION_FAILED",
            "The target changed or the option is unavailable. Inspect again.",
          );
      }
    } finally {
      await inPage(
        wc,
        args.frame_id,
        () => {
          delete (
            globalThis as typeof globalThis & { __awlSnapshot?: PageSnapshot }
          ).__awlSnapshot;
        },
        null,
      ).catch(() => {});
    }
    return {
      data: {
        dispatched: true,
        ...(args.action === "fill" ? { value_verified: true } : {}),
        action: args.action,
        tab_id: args.tab_id,
        next: "Inspect the page to verify the result.",
      },
    };
  },
);
