import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { _electron as electron } from "playwright-core";
import executablePath from "electron";

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
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "Member onboarding", exact: true })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/awl-desktop.png" });

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
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.getByRole("heading", { name: "What’s the task?" }).waitFor();
  await page.screenshot({ path: "test-results/awl-new-session.png" });
  await page.getByRole("button", { name: "Try the onboarding demo" }).click();
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("A little help here.", { exact: true }).waitFor();

  // The guide is a keyboard-dismissable modal, and the shell fits its minimum size.
  await page.getByRole("button", { name: "About this preview" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
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
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join(", ")}`);
  console.log(
    "Passed: Electron launch, takeover/resume, capability, replay, session isolation, chat, search, new session, modal, compact layout.",
  );
} finally {
  await app.close();
}
