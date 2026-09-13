import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import { prepareElectron, testElectronArgs } from "./electron-runtime.mjs";
const directory = await mkdtemp(join(tmpdir(), "awl-workflow-ui-"));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<input placeholder=\"Search papers\"><button onclick=\"setTimeout(()=>document.querySelector('#result').textContent='Results: '+document.querySelector('input').value,50)\">Search</button><p id=\"result\">Waiting</p>",
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const target = (kind, value, role = null) => ({
  kind,
  value,
  role,
  frame: null,
  shadow: [],
  within: null,
});
const step = (operation, extra = {}) => ({
  operation,
  selector: null,
  target: null,
  input: null,
  output: null,
  value: null,
  ...extra,
});
const contract = {
  schema_version: 2,
  version: 1,
  status: "draft",
  source_chat_id: "fixture",
  created_at: new Date().toISOString(),
  id: "search",
  name: "Search papers",
  description: "Find papers",
  origin: base,
  expected_version: 0,
  inputs: [{ name: "query", type: "string", description: "Paper query" }],
  outputs: [
    { name: "results", type: "string", description: "Visible results" },
  ],
  steps: [
    step("navigate", { value: base + "/" }),
    step("fill", {
      target: target("placeholder", "Search papers"),
      input: "query",
    }),
    step("click", { target: target("role", "Search", "button") }),
    step("extract_text", {
      target: target("css", "#result"),
      output: "results",
    }),
    step("assert_text", {
      target: target("css", "#result"),
      value: "Results:",
    }),
  ],
  on_unknown_state: "pause_for_human",
};
await mkdir(join(directory, "capabilities/fixture/search"), {
  recursive: true,
});
await writeFile(
  join(directory, "capabilities/fixture/search/v1.json"),
  JSON.stringify(contract),
);
const env = {
  ...process.env,
  AWL_AI_DISABLED: "1",
  AWL_TEST_USER_DATA: directory,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: await prepareElectron(),
  args: testElectronArgs([resolve("scripts/workspace-fixture.cjs")]),
  env,
});
try {
  const page = await app.firstWindow();
  assert(
    await page.getByRole("button", { name: "Record", exact: true }).isVisible(),
  );
  for (const [query, validate] of [
    ["first paper", true],
    ["second paper", true],
    ["third paper", false],
  ]) {
    await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
    await page.getByPlaceholder("Paper query").fill(query);
    await page
      .locator(".capability-entry")
      .getByRole("button", {
        name: validate ? /^Validate/ : "Run",
        exact: !validate,
      })
      .click();
    await page
      .getByText(`results: Results: ${query}`, { exact: false })
      .waitFor({ timeout: 20000 });
    assert(await page.getByText(/Final checkpoint passed/).count());
    await page
      .locator(".conversation-header .phase-pill")
      .getByText("Completed", { exact: true })
      .waitFor();
    assert(
      await page
        .locator(".agent-item.selected")
        .getByText("Completed", { exact: true })
        .isVisible(),
    );
  }
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  assert(
    await page
      .locator(".conversation-header .phase-pill")
      .getByText("Completed", { exact: true })
      .isVisible(),
  );
  // Recording has a permanent header button and takes control itself.
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByText("Recording demonstration", { exact: true }).waitFor();
  await app.evaluate(async ({ webContents }, base) => {
    const wc = webContents
      .getAllWebContents()
      .find((wc) => wc.getURL().startsWith(base));
    await wc.executeJavaScript(
      'document.querySelector("input").focus(); document.querySelector("input").select()',
    );
    await wc.debugger.sendCommand("Input.insertText", { text: "taught query" });
  }, base);
  await page.getByRole("button", { name: "Stop & build", exact: true }).click();
  await page.getByText(/Recording saved. Add OPENAI_API_KEY/).waitFor();
  await page.getByText(/recorded steps/).click();
  assert.equal(await page.locator(".recorded-steps input").count(), 0);
  assert(
    await page.getByRole("button", { name: "Build capability" }).isVisible(),
  );
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  assert(
    await page.getByRole("button", { name: "Build capability" }).isVisible(),
  );
  assert.equal(await page.getByText(/Run history ·/).count(), 1);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/workflow-review.png" });
  const deletedId = await page.evaluate(() =>
    sessionStorage.getItem("awl-selected-chat"),
  );
  const browserCount = await app.evaluate(
    ({ webContents }, base) =>
      webContents
        .getAllWebContents()
        .filter((wc) => wc.getURL().startsWith(base)).length,
    base,
  );
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByText("Recording demonstration", { exact: true }).waitFor();
  await page
    .locator(".agent-row")
    .filter({ has: page.locator(".selected") })
    .getByRole("button", { name: /^Delete session/ })
    .click();
  await page.getByRole("button", { name: /^Confirm delete session/ }).click();
  await page.waitForFunction(
    (id) => sessionStorage.getItem("awl-selected-chat") !== id,
    deletedId,
  );
  assert.equal(
    await app.evaluate(
      ({ webContents }, base) =>
        webContents
          .getAllWebContents()
          .filter((wc) => wc.getURL().startsWith(base)).length,
      base,
    ),
    browserCount - 1,
  );
  assert(
    !(await page.evaluate(() => window.awlAgent.state())).chats.some(
      (chat) => chat.id === deletedId,
    ),
  );
  await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
  await page.getByRole("button", { name: /^Delete capability/ }).click();
  await page
    .getByRole("button", { name: "Cancel deletion", exact: true })
    .click();
  assert.equal(await page.locator(".capability-entry").count(), 1);
  await page.getByRole("button", { name: /^Delete capability/ }).click();
  await page
    .getByRole("button", { name: /^Confirm delete capability/ })
    .click();
  await page.getByText("No saved capabilities yet.", { exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.awlAgent.capabilities())).drafts.length,
    0,
  );
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.getByRole("tab", { name: "Capabilities", exact: true }).click();
  await page.getByText("No saved capabilities yet.", { exact: true }).waitFor();
  console.log(
    "Workflow UI: validation, unlocked Run, fresh execution chats, asynchronous outputs, recording review and view preservation passed.",
  );
} finally {
  await app.close();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
