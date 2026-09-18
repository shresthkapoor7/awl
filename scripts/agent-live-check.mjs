import { setTimeout } from "node:timers/promises";
// Explicit opt-in: uses the real signed-in Codex account against a disposable local page.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";
if (process.env.AWL_LIVE_TEST !== "1")
  throw new Error("Set AWL_LIVE_TEST=1 to authorize this live Codex check.");
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    '<html><head><title>awl tool check</title></head><body><h1 id="title">Tool workbench</h1><label for="name">Name</label><input id="name"><button id="save" onclick="document.querySelector(\'#result\').textContent=\'Saved: \'+document.querySelector(\'#name\').value">Save</button><p id="result">Not saved</p></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWL_DEV_URL;
delete env.AWL_AI_DISABLED;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.hide();
  });
  await page
    .getByRole("heading", { name: "What’s the task?", exact: true })
    .waitFor();
  const state = await page.evaluate(() => window.awlAgent.state());
  assert.equal(state.model, "gpt-5.6-terra");
  assert.equal(state.enabled, true);
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message your agent" })
    .fill(
      `Name this chat Tool workbench. Open ${url}, inspect its DOM, and take a screenshot. Fill Name with Ada and click Save. Verify Saved: Ada appears. Do not save a capability for this disposable test. Finish with the exact sentence: Tool check passed.`,
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.awlAgent.state());
    if (
      state.chats.some(
        (chat) => chat.status !== "running" && chat.messages.length > 0,
      )
    )
      break;
    await setTimeout(250);
  }
  const chats = (await page.evaluate(() => window.awlAgent.state())).chats;
  const chat = chats.at(-1);
  assert.equal(chat.error, null, chat.error ?? "");
  assert.ok(
    chat.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.text.includes("Tool check passed."),
    ),
  );
  assert.equal(chat.name, "Tool workbench");
  for (const tool of [
    "chat_set_name",
    "browser_start",
    "browser_dom",
    "browser_screenshot",
    "browser_action",
  ])
    assert.ok(
      chat.tools.some((item) => item.name === tool && item.state === "done"),
      `Missing tool ${tool}`,
    );
  const guest = app
    .context()
    .pages()
    .find((item) => item.url() === url);
  assert.ok(guest);
  assert.equal(await guest.locator("#result").innerText(), "Saved: Ada");
  await page.reload();
  await page
    .getByRole("button", { name: "Tool workbench Completed", exact: true })
    .waitFor();
  console.log(
    `Passed: live Terra chat, ${chat.tools.length} tool calls, screenshot image input, actual browser fill/click/verification, chat rename, UI reload recovery.`,
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
}
