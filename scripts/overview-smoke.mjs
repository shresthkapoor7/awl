import assert from "node:assert/strict";
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
  page.setDefaultTimeout(15000);
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
  const first = (await page.evaluate(() => window.awlAgent.state())).chats[0];
  const second = (
    await page.evaluate(() => window.awlAgent.create("office-two"))
  ).chat;
  const publish = (chat) =>
    app.evaluate(
      ({ BrowserWindow }, chat) =>
        BrowserWindow.getAllWindows()[0].webContents.send("agent:update", chat),
      chat,
    );
  const working = {
    ...first,
    name: "Research",
    status: "running",
    messages: [{ id: "goal", role: "user", text: "Read the guide" }],
  };
  const done = {
    ...second,
    name: "Read the guide",
    status: "completed",
    messages: [{ id: "answer", role: "assistant", text: "Done." }],
  };
  await publish(working);
  await publish(done);
  const draft = page.getByRole("textbox", { name: "Message your agent" });
  await draft.fill("Keep this draft");
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  const chatTab = page.getByRole("tab", { name: "Chat", exact: true });
  const ready = () =>
    page.locator('.office-stage[data-ready="true"]').waitFor();
  const status = async (name, state) => {
    const label = page.getByRole("button", {
      name: `Open ${name} chat`,
      exact: true,
    });
    assert.equal(await label.locator(".office-status").innerText(), state);
  };
  await overview.click();
  await ready();
  assert.equal(await page.locator(".station-label").count(), 2);
  await status("Research", "Working");
  await status("Read the guide", "Completed");
  const label = page.getByRole("button", {
    name: "Open Research chat",
    exact: true,
  });
  const before = await label.boundingBox();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const after = await label.boundingBox();
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) > 1);
  await page.getByRole("button", { name: "Reset office view" }).click();
  await label.click();
  assert.equal(await draft.inputValue(), "Keep this draft");
  assert.equal(await page.locator(".office-canvas canvas").count(), 0);
  await overview.click();
  await ready();
  const other = await page
    .getByRole("button", { name: "Open Read the guide chat", exact: true })
    .boundingBox();
  await page.mouse.click(
    other.x + other.width / 2,
    other.y + other.height + 45,
  );
  await page
    .getByRole("heading", { name: "Read the guide", exact: true })
    .waitFor();
  await page.getByText("Done.", { exact: true }).waitFor();
  await overview.click();
  await ready();
  await publish({ ...working, status: "error", error: "Run failed." });
  await page
    .getByRole("button", { name: "Open Research chat", exact: true })
    .locator(".office-status[data-phase='error']")
    .waitFor();
  await status("Research", "Failed");
  await publish({ ...working, status: "stopped" });
  await page
    .getByRole("button", { name: "Open Research chat", exact: true })
    .locator(".office-status[data-phase='stopped']")
    .waitFor();
  await status("Research", "Stopped");
  await publish({
    ...working,
    status: "waiting",
    pending: {
      id: "help",
      reason: "clarification",
      question: "Which paper?",
      choices: [],
      expected_text: null,
    },
  });
  await page
    .getByRole("button", { name: "Open Research chat", exact: true })
    .locator(".office-status[data-phase='waiting']")
    .waitFor();
  await status("Research", "Needs you");
  await publish({ ...working, status: "completed" });
  await page
    .getByRole("button", { name: "Open Research chat", exact: true })
    .locator(".office-status[data-phase='finished']")
    .waitFor();
  await status("Research", "Completed");
  await overview.press("ArrowLeft");
  assert.equal(await chatTab.getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".agent-item").length === 3,
  );
  await overview.click();
  await ready();
  await status("New agent", "Not started");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      document.querySelector(".office-canvas")?.dataset.motion === "reduced",
  );
  await page
    .locator(".office-canvas canvas")
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    );
  await page.getByText("The 3D view isn’t available here.").waitFor();
  await page
    .getByRole("navigation", { name: "Office agents" })
    .getByRole("button", { name: /Read the guide Completed/ })
    .click();
  await page
    .getByRole("heading", { name: "Read the guide", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Passed: office projects real session events, working/waiting/completed states, new sessions, mesh/label selection, camera, draft preservation, reduced motion, WebGL fallback.",
  );
} finally {
  await app.close();
}
