import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { _electron as electron } from "playwright-core";
import { prepareElectron, testElectronArgs } from "./electron-runtime.mjs";
const env = { ...process.env, AWL_AI_DISABLED: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWL_DEV_URL;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: testElectronArgs(["."]),
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    if (process.env.CI) window.show();
    else window.hide();
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(
    () =>
      document.querySelector(".new-agent") &&
      !document.querySelector(".new-agent").disabled,
  );
  await page.getByRole("heading", { name: "What’s the task?" }).waitFor();
  assert.equal(await page.locator(".agent-item").count(), 1);
  assert.equal(
    await page
      .locator(
        ".user-message, .assistant-message, .handoff-card, .completion-card",
      )
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByText(/Member onboarding|Statement lookup|demo.awl.local/)
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Capability", exact: true }).count(),
    0,
  );
  const draft = page.getByRole("textbox", { name: "Message your agent" });
  await draft.fill("Keep my draft");
  const sidebar = page.locator(".sidebar");
  const dock = page.locator(".browser-dock");
  const leftDivider = page.getByRole("separator", {
    name: "Resize agent sidebar",
  });
  const rightDivider = page.getByRole("separator", {
    name: "Resize browser panel",
  });
  const left = (await sidebar.boundingBox()).width;
  await leftDivider.press("ArrowRight");
  assert.equal((await sidebar.boundingBox()).width, left + 16);
  const right = (await dock.boundingBox()).width;
  await rightDivider.press("ArrowRight");
  assert.equal((await dock.boundingBox()).width, right - 16);
  await rightDivider.press("ArrowLeft");
  assert.equal((await dock.boundingBox()).width, right);
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Hide browser", exact: true }).click();
  assert.equal(await dock.isVisible(), false);
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show browser", exact: true }).click();
  assert.equal(await draft.inputValue(), "Keep my draft");
  const shortcut = async (alt = false) =>
    app.evaluate(({ BrowserWindow }, alt) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const modifiers = [
        process.platform === "darwin" ? "meta" : "control",
        ...(alt ? ["alt"] : []),
      ];
      wc.sendInputEvent({ type: "keyDown", keyCode: "B", modifiers });
      wc.sendInputEvent({ type: "keyUp", keyCode: "B", modifiers });
    }, alt);
  await draft.focus();
  await shortcut();
  await page
    .getByRole("button", { name: "Show sidebar", exact: true })
    .waitFor();
  await shortcut(true);
  await page
    .getByRole("button", { name: "Show browser", exact: true })
    .waitFor();
  await shortcut();
  await page
    .getByRole("button", { name: "Hide sidebar", exact: true })
    .waitFor();
  await shortcut(true);
  await page
    .getByRole("button", { name: "Hide browser", exact: true })
    .waitFor();
  assert.equal(await draft.inputValue(), "Keep my draft");
  await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
  await page
    .getByRole("heading", { name: "Capabilities", exact: true })
    .waitFor();
  assert.equal(await dock.isVisible(), false);
  assert.equal(await page.getByRole("button", { name: /^Run/ }).count(), 0);
  assert.equal(
    await page
      .getByText(
        /Find latest statement|Prepare savings account|Demo capabilities/,
      )
      .count(),
    0,
  );
  await page
    .getByRole("tab", { name: "Capabilities", exact: true })
    .press("ArrowRight");
  assert.equal(await draft.inputValue(), "Keep my draft");
  // A rejected real send keeps the user's draft and never falls back to fake chat.
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await draft.inputValue(), "Keep my draft");
  assert.equal(await page.locator(".assistant-message").count(), 0);
  // Real runtime events update the same chat without replacing its composer.
  const chat = (await page.evaluate(() => window.awlAgent.state())).chats[0];
  const update = {
    ...chat,
    name: "Read the guide",
    status: "running",
    messages: [
      { id: "m1", role: "user", text: "Read the guide" },
      {
        id: "m2",
        role: "assistant",
        text: [
          "## Findings",
          "",
          "**Important** and *useful* with `inline code`.",
          "",
          "1. First",
          "2. Second",
          "",
          "- [x] Checked",
          "",
          "| Name | Result |",
          "| --- | --- |",
          "| Guide | Ready |",
          "",
          "```ts",
          "const ready = true;",
          "```",
          "",
          "[Unsafe](javascript:alert(1))",
          "[Invalid port](https://example.invalid:99999/)",
          "[Credential URL](https://fixture:fixture@example.invalid/)",
          "![Remote](https://example.invalid/pixel.png)",
          "<script>window.markdownExecuted = true</script>",
        ].join("\n"),
      },
    ],
    tools: [{ id: "t1", name: "browser_dom", state: "running" }],
  };
  await app.evaluate(
    ({ BrowserWindow }, chat) =>
      BrowserWindow.getAllWindows()[0].webContents.send("agent:update", chat),
    update,
  );
  await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor();
  await page.getByText("Agent is working", { exact: true }).waitFor();
  assert.equal(await draft.inputValue(), "Keep my draft");
  const markdown = page.locator(".assistant-message .markdown-message");
  await markdown.getByRole("heading", { name: "Findings" }).waitFor();
  assert.equal(await markdown.locator("strong").textContent(), "Important");
  assert.equal(await markdown.locator("em").textContent(), "useful");
  assert.equal(
    await markdown
      .locator("strong")
      .evaluate((element) => getComputedStyle(element).fontWeight),
    "600",
  );
  assert.equal(
    await markdown
      .locator("em")
      .evaluate((element) => getComputedStyle(element).fontSynthesisStyle),
    "auto",
  );
  assert.equal(await markdown.locator("table tbody tr").count(), 1);
  assert.equal(await markdown.locator("ol > li").count(), 2);
  assert.equal(
    await markdown.locator("pre code").textContent(),
    "const ready = true;\n",
  );
  assert.equal(
    await markdown.locator('input[type="checkbox"]').isChecked(),
    true,
  );
  assert.equal(
    await markdown.locator("img, script, a[href^='javascript:']").count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.markdownExecuted), undefined);
  await markdown.getByRole("link", { name: "Invalid port" }).click();
  await markdown.getByRole("alert").waitFor();
  assert.ok((await markdown.getByRole("alert").textContent()).length > 0);
  await markdown.getByRole("link", { name: "Credential URL" }).click();
  await markdown.getByRole("alert").waitFor();
  assert.ok((await markdown.getByRole("alert").textContent()).length > 0);
  assert.equal(
    (
      await page.evaluate(
        (agentId) => window.awlBrowser.command({ action: "get", agentId }),
        chat.id,
      )
    ).state.tabs[0].url,
    "about:blank",
  );
  // Activity stays in the centered message column as the available width changes.
  const alignedActivity = async () => {
    const messageBox = await page.locator(".assistant-message").boundingBox();
    const activityBox = await page.locator(".live-tool-activity").boundingBox();
    assert.ok(Math.abs(messageBox.x - activityBox.x) < 1);
    assert.ok(Math.abs(messageBox.width - activityBox.width) < 1);
  };
  await alignedActivity();
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await alignedActivity();
  await page.getByRole("button", { name: "Hide browser", exact: true }).click();
  await alignedActivity();
  await page.locator(".live-tool-activity summary").click();
  await alignedActivity();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/awl-chat-controls.png" });
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show browser", exact: true }).click();
  // Check both stop affordances, IPC targeting, failure retry, and acknowledgement.
  await app.evaluate(({ ipcMain }) => {
    globalThis.stopRequests = [];
    ipcMain.removeHandler("agent:stop");
    ipcMain.handle("agent:stop", (_event, id) => {
      globalThis.stopRequests.push(id);
      if (globalThis.stopRequests.length === 1) throw new Error("Test failure");
    });
  });
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
  await page.getByText("Could not stop the agent. Try again.").waitFor();
  await page
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".stop-agent-button")?.disabled,
  );
  assert.equal(
    await page.getByRole("button", { name: "Stop generating" }).isDisabled(),
    true,
  );
  assert.deepEqual(await app.evaluate(() => globalThis.stopRequests), [
    chat.id,
    chat.id,
  ]);
  await app.evaluate(
    ({ BrowserWindow }, chat) =>
      BrowserWindow.getAllWindows()[0].webContents.send("agent:update", chat),
    {
      ...update,
      status: "stopped",
      tools: [],
      error: "Stopped. Check the page before repeating an action.",
    },
  );
  await page
    .getByRole("button", { name: "Send message", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Stop agent", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".agent-item").length === 2,
  );
  await page.getByRole("heading", { name: "What’s the task?" }).waitFor();
  const selected = await page.evaluate(() =>
    sessionStorage.getItem("awl-selected-chat"),
  );
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector(".new-agent")?.disabled,
  );
  assert.equal(await page.locator(".agent-item").count(), 2);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("awl-selected-chat")),
    selected,
  );
  assert.equal(
    await page.locator(".agent-item[aria-current='page']").count(),
    1,
  );
  await page.getByRole("button", { name: /Find a session/ }).click();
  await page
    .getByRole("textbox", { name: "Search sessions" })
    .fill("not-a-session");
  await page.getByText("No sessions found.").waitFor();
  await page.getByRole("textbox", { name: "Search sessions" }).fill("");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/awl-clean-workspace.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 700),
  );
  await page.waitForFunction(() => innerWidth <= 1000);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  // Hitting the real runtime limit must not lock existing conversations.
  await page.evaluate(async () => {
    const { chats } = await window.awlAgent.state();
    for (let index = chats.length; index < 32; index++) {
      const result = await window.awlAgent.create(`limit-${index}`);
      if (!result.chat) throw new Error(result.error);
    }
  });
  await draft.fill("This existing chat still works");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page
    .locator(".create-agent-error")
    .filter({ hasText: "chat limit" })
    .waitFor();
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("awl-selected-chat")),
    selected,
  );
  assert.equal(await draft.inputValue(), "This existing chat still works");
  assert.equal(
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .locator(".live-agent-error")
    .filter({ hasText: "AI is disabled" })
    .waitFor();
  // A second failure and selecting another chat still leave its composer enabled.
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.locator(".agent-item").first().click();
  await draft.fill("Another existing chat");
  assert.equal(
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Passed: clean startup, no demo UI, live events, rejected-send draft preservation, navigation, resize/collapse, search, session reload, compact layout.",
  );
} finally {
  await app.close();
}
