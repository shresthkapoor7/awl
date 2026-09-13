import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { bindText, bindTarget } = require("../dist-electron/shared/bindings.js");
assert.equal(bindText("Member {{id}}", { id: "12345" }), "Member 12345");
assert.equal(bindText("{{id}}", { id: "{{other}}" }), "{{other}}");
assert.throws(() => bindText("{{unknown}}", { id: "12345" }));
assert.throws(() => bindText("{{id}}", { id: "" }));
const bound = bindTarget(
  {
    kind: "css",
    value: 'input[value="{{id}}"]',
    role: null,
    frame: null,
    shadow: [],
    within: null,
  },
  { id: '\"], body, [value=\"' },
);
assert.ok(!bound.value.includes("], body"));
assert.ok(bound.value.startsWith('input[value="\\22 '));
console.log("Capability binding checks passed");

const { BrowserPolicy } = require("../dist-electron/electron/policy.cjs");
const policy = new BrowserPolicy({
  destinations: [{ origin: "https://example.com", paths: ["/work/*"] }],
  actions: ["navigate", "click"],
  safeControls: [],
  blockedControls: [],
});
assert.ok(policy.destination("https://example.com/work/inquiry"));
assert.ok(!policy.destination("https://example.com/workaround"));
assert.ok(!policy.destination("https://example.com.evil.test/work/inquiry"));
assert.ok(!policy.destination("https://user:secret@example.com/work/inquiry"));
assert.throws(() => policy.assertType("fill"));
const facts = {
  url: "https://example.com/work/inquiry",
  tag: "BUTTON",
  type: "submit",
  text: "Search",
  href: null,
  allowed: false,
  blocked: false,
};
assert.throws(
  () => policy.assertAction("click", null, facts),
  /not declared safe/,
);
policy.assertAction("click", null, { ...facts, allowed: true });
assert.throws(
  () =>
    policy.assertAction("click", null, {
      ...facts,
      allowed: true,
      text: "POST SHARE + TRANSFER",
    }),
  /human operation/,
);
assert.throws(
  () =>
    policy.assertAction("click", null, {
      ...facts,
      href: "https://elsewhere.test/",
    }),
  /outside/,
);

const {
  rememberPrivate,
  redactData,
  assertPublicArtifact,
  safeStoredSession,
} = require("../dist-electron/electron/privacy.cjs");
rememberPrivate(["Avery Testperson", "42 Example Lane"]);
assert.deepEqual(
  redactData({
    name: "Avery Testperson",
    email: "avery@example.test",
    image: "data:image/png;base64,abc",
  }),
  { name: "[private]", email: "[private]" },
);
assert.throws(() => assertPublicArtifact({ target: "Avery Testperson" }));
assertPublicArtifact({ target: "{{member_id}}" });
const safe = safeStoredSession({
  chat: {
    id: "private-check",
    name: "Find Avery Testperson",
    status: "completed",
    messages: [
      { id: "m", role: "assistant", text: "Email avery@example.test" },
    ],
    tools: [],
    error: null,
    journal: [
      {
        sequence: 1,
        at: "now",
        actor: "agent",
        kind: "tool",
        label: "browser_dom",
        data: { raw: "unknown private text" },
        image: "data:image/png;base64,raw",
      },
    ],
  },
  history: [
    { type: "compaction", id: "hidden", encrypted_content: "uninspectable" },
  ],
});
assert.ok(!JSON.stringify(safe).includes("unknown private text"));
assert.ok(!JSON.stringify(safe).includes("uninspectable"));
assert.ok(!JSON.stringify(safe).includes("avery@example.test"));
assert.equal(safe.history[0].content, "Email [private]");

const { readOnlyPolicy } = require("../dist-electron/electron/policy.cjs");
const readOnly = readOnlyPolicy(policy);
readOnly.assertDestination("https://example.com/work/inquiry");
readOnly.assertType("navigate");
assert.throws(() => readOnly.assertDestination("https://elsewhere.test/"));
for (const action of ["click", "fill", "select", "press"])
  assert.throws(
    () => readOnly.assertAction(action, "Enter", { ...facts, allowed: true }),
    /not permitted/,
  );
assert.throws(
  () => readOnly.assertType("scroll"),
  /not permitted/,
  "read-only cannot broaden the base policy",
);
policy.assertAction("click", null, { ...facts, allowed: true });
console.log("Read-only browser policy preserves configured restrictions");

const { PolicyStore } = require("../dist-electron/electron/policy-store.cjs");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const policyDirectory = mkdtempSync(join(tmpdir(), "awl-policy-"));
try {
  const file = join(policyDirectory, "policy.json");
  const store = new PolicyStore(file);
  const initial = store.read();
  assert.deepEqual(initial.config.destinations, []);
  const saved = store.save(policy.config, initial.revision);
  assert.deepEqual(new PolicyStore(file).read().config, policy.config);
  assert.deepEqual(new PolicyStore(file, true).read().config, policy.config);
  const persisted = readFileSync(file, "utf8");
  assert.throws(() =>
    store.save(
      {
        ...policy.config,
        destinations: [{ origin: "https://example.com/work", paths: ["/*"] }],
      },
      saved.revision,
    ),
  );
  assert.throws(() =>
    store.save(
      {
        ...policy.config,
        destinations: [{ origin: "https://example.com", paths: ["/work*"] }],
      },
      saved.revision,
    ),
  );
  assert.equal(
    readFileSync(file, "utf8"),
    persisted,
    "validation failure leaves the last good policy untouched",
  );
  assert.throws(() => store.save(policy.config, initial.revision), /changed/);
  writeFileSync(file, JSON.stringify({ ...policy.config, actions: [] }));
  assert.throws(() => store.save(policy.config, saved.revision), /changed/);
  const reloaded = store.read();
  assert.deepEqual(reloaded.config.actions, []);
  assert.deepEqual(
    store.save(policy.config, reloaded.revision).config,
    policy.config,
  );
} finally {
  rmSync(policyDirectory, { recursive: true, force: true });
}
console.log(
  "Policy persistence, validation, and stale-editor conflict checks passed",
);
