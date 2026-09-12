import type { BrowserWindow, WebContents } from "electron";

// Listen on both the shell and its browser tabs, including detached tabs.
export function installWorkspaceShortcuts(
  window: BrowserWindow,
  contents: WebContents,
) {
  contents.on("before-input-event", (event, input) => {
    const modifier = process.platform === "darwin" ? input.meta : input.control;
    // Option+B can produce ∫ on macOS; use the physical key when available.
    if (
      !modifier ||
      input.shift ||
      input.type !== "keyDown" ||
      (input.code !== "KeyB" && input.key.toLowerCase() !== "b")
    )
      return;
    event.preventDefault();
    if (input.isAutoRepeat || window.isDestroyed()) return;
    window.webContents.focus();
    window.webContents.send(
      "workspace:toggle-panel",
      input.alt ? "right" : "left",
    );
  });
}
