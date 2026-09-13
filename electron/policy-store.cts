import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BrowserPolicy, loadPolicy } from "./policy.cjs";
import type { PolicyState } from "../shared/policy.js";

// Saving is a short, synchronous transaction: no run can begin between the
// runtime's idle check, durable replacement, and installing the new policy.
export class PolicyStore {
  constructor(
    private file: string,
    private external = false,
  ) {}
  read(): PolicyState {
    let raw: string | null = null;
    try {
      if (statSync(this.file).size > 128_000)
        throw new Error("Policy exceeds 128 KB.");
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || this.external)
        throw error;
    }
    const config =
      raw === null
        ? loadPolicy().config
        : new BrowserPolicy(JSON.parse(raw)).config;
    return {
      config,
      revision: createHash("sha256")
        .update(raw ?? "<missing>")
        .digest("hex"),
      external: this.external,
    };
  }
  save(raw: unknown, revision: string): PolicyState {
    const config = new BrowserPolicy(raw).config;
    const content = JSON.stringify(config, null, 2) + "\n";
    if (Buffer.byteLength(content) > 128_000)
      throw new Error("Policy exceeds 128 KB.");
    if (this.read().revision !== revision)
      throw new Error(
        "Access rules changed since you opened them. Reload the editor before saving.",
      );
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return {
      config,
      revision: createHash("sha256").update(content).digest("hex"),
      external: this.external,
    };
  }
}
