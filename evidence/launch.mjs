// Reviewer convenience only: no browser actions, model calls, or fabricated sessions.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const args = process.argv.slice(2);
const mode = args[0];
if (
  !["fresh", "captured"].includes(mode) ||
  args.slice(1).some((arg) => arg !== "--no-model") ||
  args.length > 2 ||
  (mode === "fresh" && args.includes("--no-model"))
) {
  console.error("Usage: node evidence/launch.mjs fresh | captured [--no-model]");
  process.exit(1);
}

try {
  await access(join(root, "dist/index.html"));
  await access(join(root, "dist-electron/electron/agent-ipc.cjs"));
} catch {
  console.error("Build awl first: npm ci && npm run build");
  process.exit(1);
}
const { prepareElectron } = await import("../scripts/electron-runtime.mjs");
const executable = await prepareElectron();
const local = join(here, ".local");
await mkdir(local, { recursive: true, mode: 0o700 });
const profile = await mkdtemp(join(local, `${mode}-`));
const policyPath = join(profile, "policy.json");
await writeFile(policyPath, await readFile(join(here, "policy.json")), { mode: 0o600 });

if (mode === "captured") {
  const bytes = await readFile(join(here, "capability/v1.json"));
  const artifact = JSON.parse(bytes.toString("utf8"));
  const validation = await readFile(join(here, "capability/v1.validation.json"));
  const witness = JSON.parse(validation.toString("utf8"));
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(artifact.source_chat_id) ||
    artifact.id !== "read_checking_balance" ||
    artifact.version !== 1 ||
    witness.hash !== createHash("sha256").update(bytes).digest("hex") ||
    witness.status !== "validated"
  ) {
    throw new Error("The captured artifact or its historical validation record does not match.");
  }
  const destination = join(profile, "capabilities", artifact.source_chat_id, artifact.id);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeFile(join(destination, "v1.json"), bytes, { mode: 0o600 });
  await writeFile(join(destination, "v1.validation.json"), validation, { mode: 0o600 });
  await writeFile(join(destination, "v1.mjs"), await readFile(join(here, "capability/v1.mjs")), { mode: 0o600 });
  console.log("Loaded the captured capability and its historical validation record. No new validation has run.");
}

const env = {
  ...process.env,
  AWL_EVIDENCE_PROFILE: profile,
  AWL_POLICY_FILE: policyPath,
  OPENAI_MODEL: "gpt-5.6-terra",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWL_DEV_URL;
if (args.includes("--no-model")) env.AWL_AI_DISABLED = "1";
console.log(`Isolated awl profile: ${profile}`);
console.log("Start the portal on port 7311. Use awl's UI to discover, validate, or run a capability.");
const child = spawn(executable, [join(here, "desktop-entry.cjs")], {
  cwd: root,
  stdio: "inherit",
  env,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
