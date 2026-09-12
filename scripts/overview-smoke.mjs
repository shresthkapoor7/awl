import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWL_DEV_URL;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  // Keep test input separate from someone typing into the live desktop preview.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.hide();
  });
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  const chat = page.getByRole("tab", { name: "Chat", exact: true });
  const draft = page.getByRole("textbox", { name: "Message your agent" });
  const officeReady = () =>
    page.locator('.office-stage[data-ready="true"]').waitFor();
  await draft.fill("Preserve this draft");
  await overview.click();
  await officeReady();
  assert.equal(await page.locator(".office-canvas canvas").count(), 1);
  assert.equal(await page.locator(".station-label").count(), 2);
  await page.getByText("2 agents").waitFor();
  await page.screenshot({ path: "test-results/awl-office.png" });

  const station = page.getByRole("button", {
    name: "Open Member onboarding chat",
    exact: true,
  });
  const original = await station.boundingBox();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const zoomed = await station.boundingBox();
  assert.ok(
    Math.abs(original.x - zoomed.x) > 1 || Math.abs(original.y - zoomed.y) > 1,
  );
  await page.getByRole("button", { name: "Reset office view" }).click();
  const reset = await station.boundingBox();
  assert.ok(
    Math.abs(original.x - reset.x) < 1 && Math.abs(original.y - reset.y) < 1,
  );
  const canvasBounds = await page
    .locator(".office-canvas canvas")
    .boundingBox();
  const orbitX = canvasBounds.x + canvasBounds.width * 0.8;
  const orbitY = canvasBounds.y + 30;
  await page.mouse.move(orbitX, orbitY);
  await page.mouse.down();
  await page.mouse.move(orbitX - 70, orbitY + 10);
  await page.mouse.up();
  const orbited = await station.boundingBox();
  assert.ok(
    Math.abs(original.x - orbited.x) > 1 ||
      Math.abs(original.y - orbited.y) > 1,
  );
  assert.equal(
    await overview.getAttribute("aria-selected"),
    "true",
    "Orbiting must not select an agent",
  );
  await page.getByRole("button", { name: "Reset office view" }).click();
  await station.click();
  assert.equal(await draft.inputValue(), "Preserve this draft");
  assert.equal(
    await page.locator(".office-canvas canvas").count(),
    0,
    "The hidden overview must release its WebGL canvas",
  );

  // The actual 3D workstation, not just its HTML label, opens the correct chat.
  await overview.click();
  await officeReady();
  const otherStation = await page
    .getByRole("button", { name: "Open Statement lookup chat", exact: true })
    .boundingBox();
  await page.mouse.click(
    otherStation.x + otherStation.width / 2,
    otherStation.y + otherStation.height + 45,
  );
  await page
    .getByRole("heading", { name: "Statement lookup", exact: true })
    .waitFor();
  assert.equal(await chat.getAttribute("aria-selected"), "true");

  // Handoff ownership and browser-local review state survive the round trip.
  await page
    .getByRole("button", { name: "Member onboarding Needs you", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Take control", exact: true })
    .first()
    .click();
  const confirmation = page.getByRole("checkbox", {
    name: "I have reviewed the member’s details",
  });
  await confirmation.check();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await overview.click();
  await officeReady();
  await page
    .getByRole("navigation", { name: "Office agents" })
    .getByRole("button", { name: /Member onboarding You’re in control/ })
    .click();
  assert.equal(await confirmation.isChecked(), true);
  assert.equal(await confirmation.isEnabled(), true);
  await page.getByRole("button", { name: "Review prepared" }).waitFor();
  await page.getByRole("button", { name: "Resume with awl" }).click();
  await page
    .getByRole("button", { name: /Try a replay without the model/ })
    .click();
  await overview.click();
  await officeReady();
  await page
    .getByRole("navigation", { name: "Office agents" })
    .getByRole("button", { name: /Member onboarding Completed/ })
    .waitFor();

  // Tab keyboard navigation and new-agent projection share the same state.
  await overview.press("ArrowLeft");
  assert.equal(await chat.getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await overview.click();
  await officeReady();
  assert.equal(await page.locator(".station-label").count(), 3);
  await page
    .getByRole("button", { name: "Open New agent chat", exact: true })
    .click();
  await page.getByRole("heading", { name: "What’s the task?" }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await overview.click();
  await officeReady();
  assert.equal(
    await page.locator(".office-canvas").getAttribute("data-motion"),
    "reduced",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 700),
  );
  await page.waitForFunction(() => window.innerWidth <= 1000);
  await page.screenshot({ path: "test-results/awl-office-compact.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );

  // Loss of WebGL must leave navigation usable.
  await page
    .locator(".office-canvas canvas")
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    );
  await page.getByText("The 3D view isn’t available here.").waitFor();
  await page
    .getByRole("navigation", { name: "Office agents" })
    .getByRole("button", { name: /Statement lookup Completed/ })
    .click();
  await page
    .getByRole("heading", { name: "Statement lookup", exact: true })
    .waitFor();
  // A machine with no WebGL at all gets the same usable fallback on first load.
  await page.reload();
  await page
    .getByRole("heading", { name: "Member onboarding", exact: true })
    .waitFor();
  await page.evaluate(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.includes("webgl")) return null;
      return getContext.call(this, type, ...args);
    };
  });
  await overview.click();
  await page.getByText("The 3D view isn’t available here.").waitFor();
  await page
    .getByRole("navigation", { name: "Office agents" })
    .getByRole("button", { name: /Member onboarding Needs you/ })
    .click();
  await page
    .getByRole("heading", { name: "Member onboarding", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(
    externalRequests,
    [],
    "The office must not fetch external models, textures, or fonts",
  );
  console.log(
    "Passed: 3D rendering, camera controls, mesh/label selection, draft and handoff preservation, live state, new agents, reduced motion, compact layout, WebGL fallback, local assets.",
  );
} finally {
  await app.close();
}
