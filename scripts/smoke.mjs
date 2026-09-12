import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { _electron as electron } from "playwright-core";
import { prepareElectron } from "./electron-runtime.mjs";

const executablePath = await prepareElectron();
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.AWL_DEV_URL;
const app = await electron.launch({
  executablePath,
  args: ["."],
  env: environment,
});
const errors = [];

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "Member onboarding", exact: true })
    .waitFor();
  // Check the OS-visible name, not just Electron's internal app.getName().
  if (process.platform === "darwin") {
    const name = execFileSync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        `ObjC.import('AppKit');
      function run(argv) {
        var apps = $.NSWorkspace.sharedWorkspace.runningApplications;
        for (var i = 0; i < apps.count; i++) {
          var app = apps.objectAtIndex(i);
          if (app.processIdentifier === Number(argv[0])) return ObjC.unwrap(app.localizedName);
        }
        throw Error('App not found');
      }`,
        String(app.process().pid),
      ],
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    assert.equal(name, "awl");
  }
  await page.evaluate(() => document.fonts.ready);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/awl-desktop.png" });

  // Both dividers resize by pointer and keyboard; toggles preserve widths and draft.
  const sidebar = page.locator(".sidebar");
  const dock = page.locator(".browser-dock");
  const draft = page.getByRole("textbox", { name: "Message your agent" });
  const leftDivider = page.getByRole("separator", {
    name: "Resize agent sidebar",
  });
  const rightDivider = page.getByRole("separator", {
    name: "Resize browser panel",
  });
  async function dragDivider(divider, distance) {
    const start = Number(await divider.getAttribute("aria-valuenow"));
    const reversed =
      (await divider.getAttribute("aria-label")) === "Resize browser panel";
    const box = await divider.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + distance,
      box.y + box.height / 2,
      { steps: 1 },
    );
    await page.mouse.up();

    await page.waitForFunction(
      ({ label, width }) =>
        Number(
          document
            .querySelector(`[aria-label="${label}"]`)
            .getAttribute("aria-valuenow"),
        ) === width,
      {
        label: await divider.getAttribute("aria-label"),
        width: start + distance * (reversed ? -1 : 1),
      },
    );
  }
  const originalLeft = (await sidebar.boundingBox()).width;
  await dragDivider(leftDivider, 40);
  assert.equal((await sidebar.boundingBox()).width, originalLeft + 40);
  await leftDivider.press("ArrowLeft");
  assert.equal((await sidebar.boundingBox()).width, originalLeft + 24);
  const originalRight = (await dock.boundingBox()).width;
  await dragDivider(rightDivider, -40);
  assert.equal((await dock.boundingBox()).width, originalRight + 40);
  await rightDivider.press("ArrowRight");
  assert.equal((await dock.boundingBox()).width, originalRight + 24);
  await draft.fill("Keep this draft");
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  assert.equal(await sidebar.isVisible(), false);
  await page.getByRole("button", { name: "Hide browser", exact: true }).click();
  assert.equal(await dock.isVisible(), false);
  assert.equal(await draft.inputValue(), "Keep this draft");
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show browser", exact: true }).click();
  assert.equal((await sidebar.boundingBox()).width, originalLeft + 24);
  assert.equal((await dock.boundingBox()).width, originalRight + 24);
  await draft.fill("");
  await draft.focus();
  assert.equal(
    await draft.evaluate((el) => getComputedStyle(el).outlineStyle),
    "none",
  );
  await page.screenshot({ path: "test-results/awl-focused-composer.png" });

  // Ownership gates the browser form, then a verified handoff unlocks replay.
  const confirmation = page.getByRole("checkbox", {
    name: "I have reviewed the member’s details",
  });
  assert.equal(await confirmation.isDisabled(), true);
  await page
    .getByRole("button", { name: "Take control", exact: true })
    .first()
    .click();
  assert.equal(await confirmation.isEnabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "Resume with awl" }).isDisabled(),
    true,
  );
  await confirmation.check();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page
    .getByText("Review ready. Hand control back when you’re done.")
    .waitFor();
  assert.equal(
    await confirmation.isEnabled(),
    true,
    "Preparing a review must not silently hand control back",
  );
  await page.getByRole("button", { name: "Hide browser", exact: true }).click();
  await page.getByRole("button", { name: "Show browser", exact: true }).click();
  assert.equal(await confirmation.isChecked(), true);
  await page
    .getByText("Review ready. Hand control back when you’re done.")
    .waitFor();
  await page.getByRole("button", { name: "Resume with awl" }).click();
  await page.getByText("That’s a workflow worth keeping.").waitFor();
  assert.equal(await confirmation.isDisabled(), true);
  await page
    .getByRole("button", {
      name: /Prepare savings account Reusable capability/,
    })
    .click();
  await page.getByRole("heading", { name: "Learn once. Run again." }).waitFor();
  await page.screenshot({ path: "test-results/awl-capability.png" });
  await page.getByRole("button", { name: "Try a replay", exact: true }).click();
  await page.getByText("Running the saved steps.", { exact: true }).waitFor();
  await page
    .getByText("Done. And ready for next time.", { exact: true })
    .waitFor();

  // Switching sessions preserves state and each session owns its conversation.
  await page
    .getByRole("button", { name: "Statement lookup Completed" })
    .click();
  await page.getByRole("heading", { name: "Account statements" }).waitFor();
  await page
    .getByRole("button", { name: "Member onboarding Completed" })
    .click();
  await page
    .getByText("Done. And ready for next time.", { exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Message your agent" })
    .fill("Keep the final submission manual.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByText("Keep the final submission manual.", { exact: true })
    .waitFor();

  // Search and empty/new-session states are functional, with honest demo responses.
  await page.getByRole("button", { name: /Find a session/ }).click();
  await page
    .getByRole("textbox", { name: "Search sessions" })
    .fill("not-a-session");
  await page.getByText("No sessions found.").waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Search sessions" })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
    "none",
  );
  await page.screenshot({ path: "test-results/awl-focused-search.png" });
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.getByRole("heading", { name: "What’s the task?" }).waitFor();
  await page.screenshot({ path: "test-results/awl-new-session.png" });
  await page.getByRole("button", { name: "Try the onboarding demo" }).click();
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("A little help here.", { exact: true }).waitFor();

  // The shell keeps all panels within its minimum window size.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 700),
  );
  await page.waitForFunction(() => window.innerWidth <= 1000);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "test-results/awl-compact.png" });
  await rightDivider.press("End");
  assert.equal(
    await page
      .locator(".conversation")
      .evaluate((el) => el.getBoundingClientRect().width >= 320),
    true,
  );
  assert.equal(
    await dock.evaluate(
      (el) => el.getBoundingClientRect().right <= window.innerWidth,
    ),
    true,
  );
  await leftDivider.press("End");
  assert.equal(
    await dock.evaluate(
      (el) => el.getBoundingClientRect().right <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join(", ")}`);
  console.log(
    "Passed: Electron launch, takeover/resume, capability, replay, session isolation, chat, search, new session, panel resizing/collapse, compact layout.",
  );
} finally {
  await app.close();
}
