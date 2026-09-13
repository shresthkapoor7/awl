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
